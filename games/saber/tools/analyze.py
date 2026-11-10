"""
Cadence Cut - beat and energy analysis for the music tracks (numpy only).

  python games/saber/tools/analyze.py <audio> [--bpm 128] [--json out.json]

Decodes the file with ffmpeg to 22.05 kHz mono, builds a spectral-flux onset envelope, finds the
tempo by autocorrelation (or uses --bpm), finds the beat phase (where beat 0 falls), then reports:
  bpm, offset (seconds of the first downbeat), duration,
  bars:   per-bar loudness 0..1 (RMS, normalised to the track)
  onsets: per-16th-note onset strength 0..9 (one digit per step, 16 per bar)
The chart generator uses the bar loudness for build-ups, drops and breathers, and the onset
strength to put blocks on the steps where the music actually hits.
"""
import json, subprocess, sys
import numpy as np

FFMPEG = 'C:/ffmpeg/bin/ffmpeg'
SR, HOP, NFFT = 22050, 256, 2048


def decode(path):
    raw = subprocess.run([FFMPEG, '-v', 'fatal', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_envelope(x):
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + (len(x) - NFFT) // HOP
    frames = np.lib.stride_tricks.as_strided(x, shape=(n, NFFT), strides=(x.strides[0] * HOP, x.strides[0]))
    mag = np.abs(np.fft.rfft(frames * win, axis=1))
    logm = np.log1p(mag * 10)
    # weight lows (kick) and mids (snare/clap) a bit more than the hiss
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    w = np.where(freqs < 200, 1.6, np.where(freqs < 4000, 1.0, 0.6))
    flux = np.maximum(0, np.diff(logm, axis=0)) @ w
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode='same')  # local mean removal
    flux = np.maximum(flux, 0)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    return flux / (flux.max() or 1), rms


def tempo(env, lo=85, hi=180):
    fps = SR / HOP
    e = env - env.mean()
    ac = np.correlate(e, e, mode='full')[len(e) - 1:]
    best, best_bpm = -1e9, 120
    for bpm10 in range(lo * 10, hi * 10 + 1):
        bpm = bpm10 / 10
        lag = 60 * fps / bpm
        score = 0
        for k, wt in ((1, 1.0), (2, 0.5), (4, 0.35)):
            L = lag * k
            i = int(L)
            if i + 1 >= len(ac):
                continue
            score += wt * (ac[i] * (1 - (L - i)) + ac[i + 1] * (L - i))
        # prefer the usual dance range so we don't lock onto half or double time
        score *= np.exp(-0.5 * ((bpm - 128) / 40) ** 2)
        if score > best:
            best, best_bpm = score, bpm
    return best_bpm


def phase(env, bpm):
    fps = SR / HOP
    period = 60 * fps / bpm
    t = np.arange(len(env))
    best, best_off = -1, 0
    for off in np.linspace(0, period, 96, endpoint=False):
        idx = np.round(np.arange(off, len(env) - 1, period)).astype(int)
        s = env[idx].sum()
        if s > best:
            best, best_off = s, off
    return best_off / fps


def refine_bpm(env, bpm):
    """Fine search +-1 BPM so the grid does not drift over a 3-minute track."""
    fps = SR / HOP
    best, best_bpm = -1, bpm
    for b in np.arange(bpm - 1, bpm + 1.0001, 0.02):
        period = 60 * fps / b
        off = phase(env, b) * fps
        idx = np.round(np.arange(off, len(env) - 1, period)).astype(int)
        s = env[idx].mean()
        if s > best:
            best, best_bpm = s, b
    return round(float(best_bpm), 2)


def downbeat(env, bpm, beat0):
    """Which of the 4 beats starts the bar: the one with the most onset energy (kicks land on 1)."""
    fps = SR / HOP
    period = 60 / bpm
    scores = []
    for k in range(4):
        times = np.arange(beat0 + k * period, len(env) / fps - 0.01, period * 4)
        scores.append(env[np.round(times * fps).astype(int)].sum())
    return beat0 + int(np.argmax(scores)) * period


def analyse(path, bpm=None):
    x = decode(path)
    env, rms = onset_envelope(x)
    fps = SR / HOP
    if bpm is None:
        bpm = refine_bpm(env, tempo(env))
    beat0 = phase(env, bpm)
    off = downbeat(env, bpm, beat0)
    bar = 240 / bpm
    while off - bar >= -0.02:
        off -= bar
    dur = len(x) / SR
    nbars = int((dur - max(off, 0)) / bar)
    bars, onsets = [], []
    step = bar / 16
    for b in range(nbars):
        t0 = off + b * bar
        i0, i1 = max(0, int(t0 * fps)), min(len(rms), int((t0 + bar) * fps))
        bars.append(float(np.sqrt(np.mean(rms[i0:i1] ** 2))) if i1 > i0 else 0.0)
        row = []
        for s in range(16):
            c = t0 + s * step
            j0, j1 = max(0, int((c - step * 0.35) * fps)), min(len(env), int((c + step * 0.35) * fps) + 1)
            row.append(env[j0:j1].max() if j1 > j0 else 0)
        onsets.append(row)
    ref = np.percentile(np.array(onsets), 90) or 1
    onsets = [''.join(str(min(9, int(v / ref * 8))) for v in row) for row in onsets]
    # grid fit: onset energy on the 16th grid vs halfway between grid lines (1.0 = no beat lock)
    on = [env[int(round((off + k * step) * fps))] for k in range(nbars * 16) if 0 <= int(round((off + k * step) * fps)) < len(env)]
    mid = [env[int(round((off + (k + 0.5) * step) * fps))] for k in range(nbars * 16) if 0 <= int(round((off + (k + 0.5) * step) * fps)) < len(env)]
    fit = float(np.mean(on) / (np.mean(mid) or 1))
    bars = np.array(bars)
    bars = bars / (np.percentile(bars, 95) or 1)
    return {'bpm': bpm, 'offset': round(float(off), 4), 'duration': round(dur, 3),
            'fit': round(fit, 2), 'bars': [round(min(1.0, float(v)), 3) for v in bars], 'onsets': onsets}


if __name__ == '__main__':
    args = sys.argv[1:]
    bpm = None
    out = None
    if '--bpm' in args:
        i = args.index('--bpm'); bpm = float(args[i + 1]); del args[i:i + 2]
    if '--json' in args:
        i = args.index('--json'); out = args[i + 1]; del args[i:i + 2]
    r = analyse(args[0], bpm)
    if out:
        with open(out, 'w') as f:
            json.dump(r, f)
    print(args[0], 'bpm', r['bpm'], 'offset', r['offset'], 'bars', len(r['bars']), 'dur', r['duration'], 'fit', r['fit'])
    print(' loud', ' '.join(str(int(v * 9)) for v in r['bars']))
    print(' kick-ish', ' '.join(o[0] + o[4] + o[8] + o[12] for o in r['onsets'][:24]))
