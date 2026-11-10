# Build data/airports.json from the OurAirports CSVs (public domain, https://ourairports.com/data/).
# Usage: python tools/build_airports.py data/airports.json <folder with airports.csv and runways.csv>
# Keeps large/medium airports and small ones with a paved runway; runways >= 1500 ft, open.
# Row: [ident, iata, name, lat, lon, elev_m, type L|M|S, municipality, country, runways]
# Runway: [le, he, length_m, width_m, paved 0|1, leLat, leLon, heLat, heLon] or [le, he, length_m, width_m, paved, heading]
import csv, json, sys, math, collections
ap = {}
for r in csv.DictReader(open(sys.argv[2] + '/airports.csv', encoding='utf8')):
    if r['type'] not in ('large_airport','medium_airport','small_airport'): continue
    ap[r['id']] = r
rw = collections.defaultdict(list)
stats = collections.Counter()
for r in csv.DictReader(open(sys.argv[2] + '/runways.csv', encoding='utf8')):
    if r['airport_ref'] not in ap or r['closed'] == '1': continue
    try: L = float(r['length_ft'] or 0)
    except: L = 0
    if L < 1500: stats['short']+=1; continue
    has_ends = all(r[k] for k in ('le_latitude_deg','le_longitude_deg','he_latitude_deg','he_longitude_deg'))
    hdg = r['le_heading_degT']
    if not has_ends and not hdg:
        # derive heading from the runway number, e.g. 09/27
        import re
        m = re.match(r'(\d{1,2})', r['le_ident'] or '')
        if m and 1 <= int(m.group(1)) <= 36: hdg = str(int(m.group(1))*10); stats['hdgFromIdent']+=1
        else: stats['noGeom']+=1; continue
    stats['ends' if has_ends else 'hdgOnly'] += 1
    s = (r['surface'] or '').upper()
    paved = 1 if any(k in s for k in ('ASP','CON','PEM','BIT','TAR','PAV','ASF','CONC')) else 0
    rec = [r['le_ident'], r['he_ident'], round(L*0.3048), round(float(r['width_ft'] or 0)*0.3048) or (30 if paved else 20), paved]
    if has_ends: rec += [round(float(r['le_latitude_deg']),6), round(float(r['le_longitude_deg']),6), round(float(r['he_latitude_deg']),6), round(float(r['he_longitude_deg']),6)]
    else: rec += [round(float(hdg),1)]
    rw[r['airport_ref']].append(rec)
out = []
tcode = {'large_airport':'L','medium_airport':'M','small_airport':'S'}
for id_, a in ap.items():
    if id_ not in rw: continue
    # small airports: keep only those with a paved runway or a long one, to stay compact
    if a['type']=='small_airport' and not any(x[4] for x in rw[id_]): continue
    try: el = round(float(a['elevation_ft'] or 0)*0.3048)
    except: el = 0
    out.append([a['ident'], a['iata_code'] or '', a['name'], round(float(a['latitude_deg']),5), round(float(a['longitude_deg']),5), el, tcode[a['type']], a['municipality'] or '', a['iso_country'], rw[id_]])
out.sort(key=lambda x: ('LMS'.index(x[6]), x[0]))
print(stats, len(out), file=sys.stderr)
json.dump(out, open(sys.argv[1], 'w', encoding='utf8'), ensure_ascii=False, separators=(',',':'))
