// Mimic tray companion for Windows.
//
// While the phone is moving the pointer (input from the Mimic Bluetooth mouse), the Windows
// arrow and hand cursors become a Mimic pointer; when the phone goes quiet, or another mouse or
// the touchpad moves, the normal cursors come back. Cursors are restored on quit, logoff,
// crash, and on every start (which heals a cursor left behind by a killed process).
//
// Builds with the C# compiler that ships with Windows (.NET Framework 4, C# 5): see build.ps1.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main(string[] args)
    {
        // Without this Windows reports 96 dpi to us and the pointer is drawn at 100% size, smaller
        // than the normal arrow on a 125-150% display.
        try { SetProcessDPIAware(); } catch { }
        // MimicTray.exe --preview <dir>: write the pointer in each theme as PNGs, then exit.
        if (args.Length == 2 && args[0] == "--preview")
        {
            foreach (var t in Theme.All)
            {
                var seq = new List<Cursors.Pose> { Cursors.Pose.Rest };
                seq.AddRange(Cursors.PressFrames); seq.Add(Cursors.Held); seq.AddRange(Cursors.ReleaseFrames);
                for (int i = 0; i < seq.Count; i++)
                    using (var b = Cursors.DrawPointer(128, t.Color, seq[i])) b.Save(Path.Combine(args[1], "ptr-" + t.Name + "-" + i + ".png"));
            }
            return;
        }
        bool fresh;
        using (var mutex = new Mutex(true, "MimicTray.SingleInstance", out fresh))
        {
            if (!fresh) return;
            Cursors.Restore(); // heal a cursor left by a previous crash or kill
            Cursors.Log("start: system cursors restored, display scale " + Dpi.Scale);
            AppDomain.CurrentDomain.UnhandledException += delegate { Cursors.Restore(); };
            Application.ThreadException += delegate { Cursors.Restore(); };
            SystemEvents.SessionEnding += delegate { Cursors.Restore(); };
            Application.ApplicationExit += delegate { Cursors.Restore(); };
            Application.EnableVisualStyles();
            Application.Run(new TrayContext());
        }
    }
}

/** Swapping and restoring the system cursors. */
static class Cursors
{
    const uint OCR_NORMAL = 32512, OCR_HAND = 32649, SPI_SETCURSORS = 0x57;
    public static bool Swapped { get; private set; }
    public static bool Pressed { get; private set; }

    [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr hcur, uint id);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint winIni);
    [DllImport("user32.dll")] static extern IntPtr CreateIconIndirect(ref ICONINFO icon);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO info);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);

    [StructLayout(LayoutKind.Sequential)]
    struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }

    /** Transitions go to %TEMP%\MimicTray.log (tiny; useful when something looks wrong). */
    public static void Log(string what)
    {
        try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "MimicTray.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + what + Environment.NewLine); }
        catch { }
    }

    public static void Swap() { if (!Swapped) Show(Pressed ? Held : Pose.Rest); }

    /** Show one frame of the Mimic pointer. */
    public static void Show(Pose pose)
    {
        if (!Swapped) Log("swap");
        // SetSystemCursor takes ownership of the handle, so each slot gets its own copy.
        SetSystemCursor(MakePointer(pose), OCR_NORMAL);
        SetSystemCursor(MakePointer(pose), OCR_HAND);
        Swapped = true;
    }

    // Click animation: a short queue of frames played by a ~16 ms timer.
    static readonly Queue<Pose> frames = new Queue<Pose>();
    static System.Windows.Forms.Timer anim;

    /** Mimic button went down or up: play the press or release animation. */
    public static void Press(bool down)
    {
        if (down == Pressed && Swapped) return;
        Pressed = down;
        frames.Clear();
        foreach (var f in down ? PressFrames : ReleaseFrames) frames.Enqueue(f);
        if (down) frames.Enqueue(Held);
        if (anim == null)
        {
            anim = new System.Windows.Forms.Timer { Interval = 16 };
            anim.Tick += delegate
            {
                if (frames.Count == 0) { anim.Stop(); return; }
                Show(frames.Dequeue());
            };
        }
        Show(frames.Dequeue());
        anim.Start();
    }

    public static void Restore()
    {
        SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
        if (Swapped) Log("restore");
        Swapped = false; Pressed = false;
        frames.Clear(); if (anim != null) anim.Stop();
    }

    /** The mini octopus in the current theme colour; the hotspot is the tip of its raised arm. */
    static IntPtr MakePointer(Pose pose)
    {
        int size = (int)Math.Round(32 * Dpi.Scale);
        using (var bmp = DrawPointer(size, Theme.Current.Color, pose))
        {
            IntPtr hIcon = bmp.GetHicon();
            ICONINFO info;
            GetIconInfo(hIcon, out info);
            info.fIcon = false; info.xHotspot = Math.Max(1, size / 32); info.yHotspot = Math.Max(1, size / 32);
            IntPtr cur = CreateIconIndirect(ref info);
            DeleteObject(info.hbmMask); DeleteObject(info.hbmColor); DestroyIcon(hIcon);
            return cur;
        }
    }

    /** Outline of a tapered tube along a cubic curve (width w0 at p0 down to w1 at p3). */
    static PointF[] Tentacle(PointF p0, PointF p1, PointF p2, PointF p3, float w0, float w1)
    {
        const int N = 18;
        var left = new PointF[N + 1]; var right = new PointF[N + 1];
        for (int i = 0; i <= N; i++)
        {
            float t = i / (float)N, u = 1 - t;
            float x = u * u * u * p0.X + 3 * u * u * t * p1.X + 3 * u * t * t * p2.X + t * t * t * p3.X;
            float y = u * u * u * p0.Y + 3 * u * u * t * p1.Y + 3 * u * t * t * p2.Y + t * t * t * p3.Y;
            float dx = 3 * u * u * (p1.X - p0.X) + 6 * u * t * (p2.X - p1.X) + 3 * t * t * (p3.X - p2.X);
            float dy = 3 * u * u * (p1.Y - p0.Y) + 6 * u * t * (p2.Y - p1.Y) + 3 * t * t * (p3.Y - p2.Y);
            float len = (float)Math.Sqrt(dx * dx + dy * dy); if (len < 1e-4f) len = 1e-4f;
            float w = (w0 + (w1 - w0) * (float)Math.Pow(t, 0.8)) / 2;
            float nx = -dy / len * w, ny = dx / len * w;
            left[i] = new PointF(x + nx, y + ny); right[i] = new PointF(x - nx, y - ny);
        }
        var poly = new List<PointF>(left);
        for (int i = N; i >= 0; i--) poly.Add(right[i]);
        return poly.ToArray();
    }

    /** One frame of the pointer. Lean/squash/ripple are 0..1; eyes 0 = open, 1 = squeezed shut. */
    public struct Pose
    {
        public float Lean, Squash, Eyes, Ripple, RippleAlpha;
        public static Pose Rest { get { return new Pose(); } }
        public Pose(float lean, float squash, float eyes, float ripple, float rippleAlpha)
        { Lean = lean; Squash = squash; Eyes = eyes; Ripple = ripple; RippleAlpha = rippleAlpha; }
    }

    /** Press, hold and release frames; the arm tip (the click point) never moves. */
    public static readonly Pose[] PressFrames = {
        new Pose(0.45f, 0.3f, 0.5f, 0.15f, 0.9f),
        new Pose(1f, 1f, 1f, 0.45f, 0.8f),
        new Pose(1f, 1f, 1f, 0.8f, 0.45f),
        new Pose(1f, 1f, 1f, 1f, 0.15f),
    };
    public static readonly Pose Held = new Pose(1f, 1f, 1f, 0f, 0f);
    public static readonly Pose[] ReleaseFrames = {
        new Pose(-0.35f, -0.25f, 0.4f, 0f, 0f),   // springs back past rest
        new Pose(-0.1f, -0.05f, 0.1f, 0f, 0f),
        new Pose(0f, 0f, 0f, 0f, 0f),
    };

    /**
     * A round little octopus reaching up-left with one chubby arm; the tip of that arm is the
     * click point. Clicking leans the body into the arm (the arm "presses"), squishes it, squeezes
     * the eyes shut and pops a ripple at the tip. Drawn on a 32-unit grid, scaled to [size] px.
     */
    public static Bitmap DrawPointer(int size, Color fill, Pose pose)
    {
        var bmp = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        var dark = Color.FromArgb(255, 0x0A, 0x0B, 0x0D);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            g.ScaleTransform(size / 32f, size / 32f);

            // Head: leans toward the tip and squashes when pressing.
            float cx = 15.4f - 1.5f * pose.Lean, cy = 12.6f - 1.5f * pose.Lean;
            float rx = 6.9f * (1 + 0.07f * pose.Squash), ry = 6.4f * (1 - 0.11f * pose.Squash);
            var head = new RectangleF(cx - rx, cy - ry, 2 * rx, 2 * ry);

            // Arm: a tentacle growing from the left of the head, dipping out and curling up
            // into the point. It tapers from thick to a fine rounded tip at the click point.
            var root = new PointF(cx - rx * 0.78f, cy + ry * 0.05f);
            var tip = new PointF(2.0f, 2.0f);
            PointF[] arm = Tentacle(root, new PointF(root.X - 4.6f, root.Y + 0.4f),
                new PointF(tip.X - 0.2f, tip.Y + 6.2f), tip, 4.6f, 1.7f);

            // Legs: four short wavy tentacles under the head.
            var legs = new List<PointF[]>();
            float baseY = cy + ry * 0.62f;
            float[] xs = { -4.6f, -1.6f, 1.6f, 4.6f };
            for (int i = 0; i < 4; i++)
            {
                float x = cx + xs[i] * (1 + 0.05f * pose.Squash), dir = i < 2 ? -1 : 1;
                float len = 6.2f - 0.9f * pose.Squash;
                legs.Add(new PointF[] {
                    new PointF(x, baseY), new PointF(x + dir * 1.6f, baseY + len * 0.45f),
                    new PointF(x - dir * 1.2f, baseY + len * 0.7f), new PointF(x + dir * 0.9f, baseY + len) });
            }

            // Outline pass, then fill pass: one clean silhouette with no inner seams.
            for (int pass = 0; pass < 2; pass++)
            {
                bool outline = pass == 0;
                Color c = outline ? dark : fill;
                float grow = outline ? 2.3f : 0f;
                using (var pen = new Pen(c, 2.7f + grow) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    foreach (var l in legs) g.DrawBezier(pen, l[0], l[1], l[2], l[3]);
                using (var b = new SolidBrush(c))
                {
                    if (outline)
                        using (var edge = new Pen(dark, grow) { LineJoin = LineJoin.Round })
                            g.DrawPolygon(edge, arm);
                    g.FillPolygon(b, arm);
                    float tr = 0.85f + (outline ? grow / 2 : 0);              // rounded fingertip
                    g.FillEllipse(b, tip.X - tr, tip.Y - tr, 2 * tr, 2 * tr);
                }
                using (var b = new SolidBrush(c))
                    g.FillEllipse(b, head.X - grow / 2, head.Y - grow / 2, head.Width + grow, head.Height + grow);
            }

            // Face.
            float ey = cy - 0.6f, el = cx - 3.0f, er = cx + 1.4f;
            if (pose.Eyes < 0.5f)
            {
                float h = 3.6f * (1 - pose.Eyes * 1.6f);
                using (var eye = new SolidBrush(dark))
                {
                    g.FillEllipse(eye, el, ey - h / 2, 2.9f, h);
                    g.FillEllipse(eye, er, ey - h / 2, 2.9f, h);
                }
                if (pose.Eyes < 0.2f)
                    using (var shine = new SolidBrush(Color.White))
                    {
                        g.FillEllipse(shine, el + 1.5f, ey - 1.3f, 1.1f, 1.1f);
                        g.FillEllipse(shine, er + 1.5f, ey - 1.3f, 1.1f, 1.1f);
                    }
            }
            else
                using (var lid = new Pen(dark, 1.25f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    // squeezed shut: > <
                    g.DrawLines(lid, new[] { new PointF(el + 0.3f, ey - 1.1f), new PointF(el + 2.5f, ey), new PointF(el + 0.3f, ey + 1.1f) });
                    g.DrawLines(lid, new[] { new PointF(er + 2.6f, ey - 1.1f), new PointF(er + 0.4f, ey), new PointF(er + 2.6f, ey + 1.1f) });
                }
            using (var blush = new SolidBrush(Color.FromArgb(150, 0xFF, 0x7A, 0x93)))
            {
                g.FillEllipse(blush, el - 1.2f, ey + 2.0f, 2.4f, 1.4f);
                g.FillEllipse(blush, er + 1.8f, ey + 2.0f, 2.4f, 1.4f);
            }
            if (pose.Squash > 0.5f)
                using (var mouth = new SolidBrush(dark))                    // open, happy: D on its back
                    g.FillPie(mouth, cx - 2.1f, ey + 0.9f, 3.4f, 3.2f, 0, 180);
            else
                using (var mouth = new Pen(dark, 1.35f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawArc(mouth, cx - 2.2f, ey + 0.5f, 3.6f, 2.8f, 25, 130);

            // Click sparks: two short dashes flying out of the tip (right and down).
            if (pose.RippleAlpha > 0 && pose.Ripple > 0)
            {
                float r0 = 2.5f + 5f * pose.Ripple, r1 = r0 + 2.8f;
                using (var spark = new Pen(Color.FromArgb((int)(255 * pose.RippleAlpha), fill), 1.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    g.DrawLine(spark, 1.2f + r0, 0.9f, 1.2f + r1, 0.6f);
                    g.DrawLine(spark, 0.9f, 1.2f + r0, 0.6f, 1.2f + r1);
                }
            }
        }
        return bmp;
    }
}

/** Pointer colours, matching the phone app's themes. Stored per user in the registry. */
class Theme
{
    public string Name; public Color Color;
    Theme(string n, Color c) { Name = n; Color = c; }
    public static readonly Theme[] All = {
        new Theme("Chameleon", Color.FromArgb(255, 0x5E, 0xE6, 0xD0)),
        new Theme("Ink", Color.FromArgb(255, 0x7C, 0xC4, 0xFF)),
        new Theme("Arcade", Color.FromArgb(255, 0xFF, 0x5D, 0x73)),
    };
    const string Key = @"Software\Mimic";
    public static Theme Current
    {
        get
        {
            using (var k = Registry.CurrentUser.OpenSubKey(Key))
            {
                string n = k == null ? null : k.GetValue("PointerTheme") as string;
                foreach (var t in All) if (t.Name == n) return t;
                return All[0];
            }
        }
        set { using (var k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue("PointerTheme", value.Name); }
    }
}

static class Dpi
{
    [DllImport("user32.dll")] static extern int GetDpiForSystem();
    public static float Scale
    {
        get { try { return GetDpiForSystem() / 96f; } catch { return 1f; } }
    }
}

/** Hidden window that receives raw mouse input from every device, tagged by device. */
class RawInputWindow : NativeWindow
{
    const int WM_INPUT = 0x00FF, RID_INPUT = 0x10000003, RIDI_DEVICENAME = 0x20000007;
    const uint RIDEV_INPUTSINK = 0x00000100;
    const uint RIM_TYPEMOUSE = 0, RIM_TYPEKEYBOARD = 1;
    const ushort VK_F9 = 0x78, RI_KEY_BREAK = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICE { public ushort usUsagePage; public ushort usUsage; public uint dwFlags; public IntPtr hwndTarget; }
    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTHEADER { public uint dwType; public uint dwSize; public IntPtr hDevice; public IntPtr wParam; }
    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICELIST { public IntPtr hDevice; public uint dwType; }

    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr hRawInput, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr hDevice, uint command, System.Text.StringBuilder data, ref uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[] list, ref uint count, uint size);

    readonly Dictionary<IntPtr, bool> isMimic = new Dictionary<IntPtr, bool>();
    public event Action MimicMoved;
    /** Mimic mouse button went down (true) or up (false). */
    public event Action<bool> MimicButton;
    public event Action OtherMoved;
    /** The phone's Centre (Grip CENTRE / hold Vol Up sends F9 from the Mimic keyboard). */
    public event Action MimicCentre;

    public RawInputWindow()
    {
        CreateHandle(new CreateParams());
        // mice (usage 2) for the pointer swap, keyboards (usage 6) to see the phone's Centre key;
        // INPUTSINK only listens: keys and moves still reach the focused app as normal
        var dev = new RAWINPUTDEVICE[] {
            new RAWINPUTDEVICE { usUsagePage = 1, usUsage = 2, dwFlags = RIDEV_INPUTSINK, hwndTarget = Handle },
            new RAWINPUTDEVICE { usUsagePage = 1, usUsage = 6, dwFlags = RIDEV_INPUTSINK, hwndTarget = Handle } };
        bool ok = RegisterRawInputDevices(dev, (uint)dev.Length, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
        Cursors.Log("raw input registered=" + ok + (ok ? "" : " error=" + Marshal.GetLastWin32Error()) + " hwnd=" + Handle);
    }

    /** Device paths look like \\?\HID#{00001124-...}_VID&0001038F_PID&1200&Col01#... */
    public static bool IsMimicPath(string path)
    {
        if (path == null) return false;
        string p = path.ToUpperInvariant();
        return p.Contains("VID&0001038F_PID&1200") || p.Contains("MIMIC");
    }

    public static string DeviceName(IntPtr h)
    {
        uint size = 0;
        GetRawInputDeviceInfo(h, RIDI_DEVICENAME, null, ref size);
        if (size == 0) return null;
        var sb = new System.Text.StringBuilder((int)size + 1);
        GetRawInputDeviceInfo(h, RIDI_DEVICENAME, sb, ref size);
        return sb.ToString();
    }

    /** True if a Mimic mouse is currently attached (paired and connected). */
    public static bool MimicPresent()
    {
        uint count = 0, sz = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
        GetRawInputDeviceList(null, ref count, sz);
        if (count == 0) return false;
        var list = new RAWINPUTDEVICELIST[count];
        GetRawInputDeviceList(list, ref count, sz);
        foreach (var d in list) if (d.dwType == RIM_TYPEMOUSE && IsMimicPath(DeviceName(d.hDevice))) return true;
        return false;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            uint hsz = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
            uint size = 0;
            GetRawInputData(m.LParam, RID_INPUT, IntPtr.Zero, ref size, hsz);   // ask the full size
            IntPtr buf = Marshal.AllocHGlobal((int)Math.Max(size, hsz));
            try
            {
                if (size > 0 && GetRawInputData(m.LParam, RID_INPUT, buf, ref size, hsz) != unchecked((uint)-1))
                {
                    var hdr = (RAWINPUTHEADER)Marshal.PtrToStructure(buf, typeof(RAWINPUTHEADER));
                    bool mimic;
                    if (!isMimic.TryGetValue(hdr.hDevice, out mimic))
                    {
                        string name = DeviceName(hdr.hDevice);
                        mimic = IsMimicPath(name);
                        isMimic[hdr.hDevice] = mimic;
                        Cursors.Log("device " + (name ?? "(unknown)") + " mimic=" + mimic);
                    }
                    if (hdr.dwType == RIM_TYPEKEYBOARD)
                    {
                        // RAWKEYBOARD: MakeCode (2), Flags (2), Reserved (2), VKey (2)
                        ushort kflags = (ushort)Marshal.ReadInt16(buf, (int)hsz + 2);
                        ushort vkey = (ushort)Marshal.ReadInt16(buf, (int)hsz + 6);
                        if (mimic && vkey == VK_F9 && (kflags & RI_KEY_BREAK) == 0 && MimicCentre != null) MimicCentre();
                    }
                    else if (mimic)
                    {
                        // RAWMOUSE: usFlags (2) + pad (2), then usButtonFlags.
                        ushort flags = (ushort)Marshal.ReadInt16(buf, (int)hsz + 4);
                        const ushort DOWN = 0x0001 | 0x0004 | 0x0010, UP = 0x0002 | 0x0008 | 0x0020; // left, right, middle
                        if ((flags & DOWN) != 0 && MimicButton != null) MimicButton(true);
                        else if ((flags & UP) != 0 && MimicButton != null) MimicButton(false);
                        if (MimicMoved != null) MimicMoved();
                    }
                    else if (OtherMoved != null) OtherMoved();
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        base.WndProc(ref m);
    }
}

class TrayContext : ApplicationContext
{
    const int IDLE_MS = 1500;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    readonly NotifyIcon tray;
    readonly RawInputWindow input;
    readonly System.Windows.Forms.Timer timer;
    readonly ToolStripMenuItem status, startup;
    DateTime lastMimic = DateTime.MinValue;
    int presenceTick;
    bool present;

    public TrayContext()
    {
        status = new ToolStripMenuItem("Mimic: starting") { Enabled = false };
        startup = new ToolStripMenuItem("Start with Windows") { Checked = StartsWithWindows(), CheckOnClick = true };
        startup.Click += delegate { SetStartWithWindows(startup.Checked); };
        var games = new ToolStripMenuItem("Open games folder");
        string gamesDir = GamesDir();
        games.Enabled = gamesDir != null;
        games.Click += delegate { if (gamesDir != null) Process.Start("explorer.exe", "\"" + gamesDir + "\""); };
        var colour = new ToolStripMenuItem("Pointer colour");
        foreach (var t in Theme.All)
        {
            var theme = t;
            var item = new ToolStripMenuItem(t.Name) { Checked = Theme.Current.Name == t.Name };
            item.Click += delegate
            {
                Theme.Current = theme;
                foreach (ToolStripMenuItem i in colour.DropDownItems) i.Checked = i.Text == theme.Name;
                if (Cursors.Swapped) Cursors.Show(Cursors.Pressed ? Cursors.Held : Cursors.Pose.Rest);
            };
            colour.DropDownItems.Add(item);
        }
        var free = new ToolStripMenuItem("Free the pointer");
        free.Click += delegate { Clip.Release("menu"); };
        var quit = new ToolStripMenuItem("Quit");
        quit.Click += delegate { Cursors.Restore(); tray.Visible = false; Application.Exit(); };

        var menu = new ContextMenuStrip();
        menu.Items.AddRange(new ToolStripItem[] { status, new ToolStripSeparator(), colour, games, free, startup, new ToolStripSeparator(), quit });
        tray = new NotifyIcon { Icon = Octopus.Icon(), Text = "Mimic", ContextMenuStrip = menu, Visible = true };

        input = new RawInputWindow();
        input.MimicMoved += delegate { lastMimic = DateTime.UtcNow; if (!Cursors.Swapped) Cursors.Swap(); };
        input.MimicButton += delegate(bool down) { lastMimic = DateTime.UtcNow; Cursors.Press(down); };
        // a touchpad or mouse takes the pointer back only once the phone has gone quiet; a touchpad
        // twitch while the phone moves used to flip the cursors back and forth every few ms
        input.MimicCentre += delegate { lastMimic = DateTime.UtcNow; CentrePointer(); };
        input.OtherMoved += delegate { if (Cursors.Swapped && (DateTime.UtcNow - lastMimic).TotalMilliseconds > 400) Cursors.Restore(); };

        present = RawInputWindow.MimicPresent();
        timer = new System.Windows.Forms.Timer { Interval = 250 };
        timer.Tick += delegate { Tick(); };
        timer.Start();
        UpdateStatus();
    }

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);

    /** Centre on the phone: put the visible pointer in the middle of the screen it is on. A game
     * that hides and locks the pointer handles F9 itself, so leave it alone then. */
    static void CentrePointer()
    {
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
        if (!GetCursorInfo(ref ci) || (ci.flags & 1) == 0) return;   // CURSOR_SHOWING
        var b = Screen.FromPoint(new System.Drawing.Point(ci.pt.X, ci.pt.Y)).Bounds;
        SetCursorPos(b.Left + b.Width / 2, b.Top + b.Height / 2);
        Cursors.Log("centre: pointer to middle of " + b);
    }

    void Tick()
    {
        if (Cursors.Swapped && (DateTime.UtcNow - lastMimic).TotalMilliseconds > IDLE_MS) Cursors.Restore();
        if (++presenceTick >= 20) { presenceTick = 0; present = RawInputWindow.MimicPresent(); } // every 5 s
        Clip.Watch((DateTime.UtcNow - lastMimic).TotalMilliseconds < 2000);
        UpdateStatus();
    }

    void UpdateStatus()
    {
        string s = Cursors.Swapped ? "Mimic: active" : present ? "Mimic: idle" : "Mimic: phone not connected";
        if (status.Text != s) { status.Text = s; tray.Text = s; }
    }

    static string GamesDir()
    {
        // windows\out\MimicTray.exe -> ..\..\games
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        string d = Path.GetFullPath(Path.Combine(exeDir, "..", "..", "games"));
        return Directory.Exists(d) ? d : null;
    }

    static bool StartsWithWindows()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("MimicTray") != null;
    }

    static void SetStartWithWindows(bool on)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (on) k.SetValue("MimicTray", "\"" + Application.ExecutablePath + "\"");
            else k.DeleteValue("MimicTray", false);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { Cursors.Restore(); timer.Dispose(); tray.Dispose(); input.DestroyHandle(); }
        base.Dispose(disposing);
    }
}

/** The tray icon: the Mimic octopus, drawn in code so there is no asset to ship. */
static class Octopus
{
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon Icon()
    {
        int s = (int)Math.Round(32 * Dpi.Scale);
        using (var bmp = new Bitmap(s, s, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                float k = s / 120f;
                g.ScaleTransform(k, k);
                var teal = Color.FromArgb(255, 0x5E, 0xE6, 0xD0);
                using (var arm = new Pen(teal, 9f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    g.DrawBezier(arm, 34, 68, 28, 82, 18, 84, 16, 98);
                    g.DrawBezier(arm, 50, 72, 50, 86, 42, 92, 44, 101);
                    g.DrawBezier(arm, 70, 72, 70, 86, 78, 92, 76, 101);
                    g.DrawBezier(arm, 86, 68, 92, 82, 102, 84, 104, 98);
                }
                using (var body = new SolidBrush(teal))
                using (var path = new GraphicsPath())
                {
                    path.AddBezier(28, 64, 28, 38, 42, 20, 60, 20);
                    path.AddBezier(60, 20, 78, 20, 92, 38, 92, 64);
                    path.AddBezier(92, 64, 92, 72, 28, 72, 28, 64);
                    g.FillPath(body, path);
                }
                using (var eye = new SolidBrush(Color.FromArgb(255, 0x0A, 0x0B, 0x0D)))
                {
                    g.FillEllipse(eye, 41, 42, 16, 16);
                    g.FillEllipse(eye, 63, 42, 16, 16);
                }
            }
            IntPtr h = bmp.GetHicon();
            var icon = (Icon)System.Drawing.Icon.FromHandle(h).Clone();
            DestroyIcon(h);
            return icon;
        }
    }
}

/**
 * Windows can fence the pointer into a rectangle (ClipCursor). Games and browsers do it while
 * they own the mouse, and sometimes leave the fence behind, so the pointer cannot reach part of
 * the screen. A fence with the pointer visible while the phone is moving it is a leftover: free
 * it, and log which window was in front so the culprit can be found.
 */
static class Clip
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
    [DllImport("user32.dll")] static extern bool GetClipCursor(out RECT r);
    [DllImport("user32.dll")] static extern bool ClipCursor(IntPtr r);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    static DateTime since = DateTime.MinValue;
    static string lastRect = "";

    static bool Clipped(out RECT r)
    {
        GetClipCursor(out r);
        int x = GetSystemMetrics(76), y = GetSystemMetrics(77), w = GetSystemMetrics(78), h = GetSystemMetrics(79);
        return r.L > x || r.T > y || r.R < x + w || r.B < y + h;
    }

    static string Foreground()
    {
        IntPtr h = GetForegroundWindow();
        var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256);
        uint pid; GetWindowThreadProcessId(h, out pid);
        string proc = "?";
        try { proc = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
        return proc + " \"" + sb + "\"";
    }

    /** Called every 250 ms. phoneActive: the phone moved the pointer in the last 2 s. */
    public static void Watch(bool phoneActive)
    {
        RECT r;
        if (!Clipped(out r)) { since = DateTime.MinValue; lastRect = ""; return; }
        string rect = r.L + "," + r.T + "-" + r.R + "," + r.B;
        if (rect != lastRect) { lastRect = rect; since = DateTime.UtcNow; Cursors.Log("pointer fenced to " + rect + " by/in front: " + Foreground()); }
        var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
        bool visible = GetCursorInfo(ref ci) && (ci.flags & 1) != 0;   // a game holding the mouse hides it
        if (phoneActive && visible && (DateTime.UtcNow - since).TotalMilliseconds > 1000) Release("stale fence while the phone was pointing");
    }

    public static void Release(string why)
    {
        RECT r; bool was = Clipped(out r);
        ClipCursor(IntPtr.Zero);
        Cursors.Log("pointer freed (" + why + ")" + (was ? "" : ", it was not fenced"));
        since = DateTime.MinValue; lastRect = "";
    }
}
