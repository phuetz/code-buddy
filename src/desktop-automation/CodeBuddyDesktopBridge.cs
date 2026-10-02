using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Windows.Automation;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

public static class NativeMethods {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public const uint WM_CLOSE = 0x0010;
}

public class CodeBuddyDesktopBridge {
    [STAThread]
    public static void Main(string[] args) {
        // Prevent console output buffering
        Console.OutputEncoding = Encoding.UTF8;

        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 50 * 1024 * 1024; // Allow large UIA tree outputs

        if (args.Length > 0) {
            string cmd = args[0].ToLower();
            if (cmd == "get_uia_tree") {
                int maxDepth = args.Length > 1 ? Convert.ToInt32(args[1]) : 5;
                try {
                    var req = new Dictionary<string, object>();
                    req["action"] = "get_uia_tree";
                    req["maxDepth"] = maxDepth;
                    var res = HandleRequest(req);
                    if (res.ContainsKey("elements")) {
                        Console.WriteLine(serializer.Serialize(res["elements"]));
                    } else {
                        Console.WriteLine("[]");
                    }
                } catch {
                    Console.WriteLine("[]");
                }
                return;
            }
        }

        string line;
        while ((line = Console.ReadLine()) != null) {
            line = line.Trim();
            if (string.IsNullOrEmpty(line)) continue;

            try {
                var request = serializer.Deserialize<Dictionary<string, object>>(line);
                var response = HandleRequest(request);
                string jsonResponse = serializer.Serialize(response);
                Console.WriteLine(jsonResponse);
            } catch (Exception ex) {
                var errResponse = new Dictionary<string, object>();
                errResponse["success"] = false;
                errResponse["error"] = ex.ToString();
                Console.WriteLine(serializer.Serialize(errResponse));
            }
        }
    }

    private static int GetInt(Dictionary<string, object> dict, string key, int defaultValue = 0) {
        if (!dict.ContainsKey(key) || dict[key] == null) return defaultValue;
        return Convert.ToInt32(dict[key]);
    }

    private static double GetDouble(Dictionary<string, object> dict, string key, double defaultValue = 0) {
        if (!dict.ContainsKey(key) || dict[key] == null) return defaultValue;
        return Convert.ToDouble(dict[key]);
    }

    private static string GetString(Dictionary<string, object> dict, string key, string defaultValue = null) {
        if (!dict.ContainsKey(key) || dict[key] == null) return defaultValue;
        return dict[key].ToString();
    }

    private static bool GetBool(Dictionary<string, object> dict, string key, bool defaultValue = false) {
        if (!dict.ContainsKey(key) || dict[key] == null) return defaultValue;
        return Convert.ToBoolean(dict[key]);
    }

    private static List<string> GetStringList(Dictionary<string, object> dict, string key) {
        if (!dict.ContainsKey(key) || dict[key] == null) return new List<string>();
        var list = new List<string>();
        var rawList = dict[key] as System.Collections.IEnumerable;
        if (rawList != null) {
            foreach (var item in rawList) {
                if (item != null) list.Add(item.ToString());
            }
        }
        return list;
    }

    private static byte GetModifierVk(string modifier) {
        switch (modifier.ToLower()) {
            case "ctrl":
            case "control":
                return 0x11;
            case "alt":
                return 0x12;
            case "shift":
                return 0x10;
            case "win":
            case "meta":
            case "command":
                return 0x5B;
            default:
                return 0;
        }
    }

    private static Dictionary<string, object> GetWindowInfo(IntPtr hwnd) {
        var w = new Dictionary<string, object>();
        w["handle"] = hwnd.ToInt64().ToString();

        int len = NativeMethods.GetWindowTextLength(hwnd);
        if (len > 0) {
            var sb = new StringBuilder(len + 1);
            NativeMethods.GetWindowText(hwnd, sb, sb.Capacity);
            w["title"] = sb.ToString();
        } else {
            w["title"] = "";
        }

        uint pid = 0;
        NativeMethods.GetWindowThreadProcessId(hwnd, out pid);
        w["pid"] = (int)pid;

        string pName = "";
        try {
            var proc = Process.GetProcessById((int)pid);
            if (proc != null) pName = proc.ProcessName ?? "";
        } catch {}
        w["processName"] = pName;

        NativeMethods.RECT r;
        if (NativeMethods.GetWindowRect(hwnd, out r)) {
            var bounds = new Dictionary<string, object>();
            bounds["x"] = r.Left;
            bounds["y"] = r.Top;
            bounds["width"] = r.Right - r.Left;
            bounds["height"] = r.Bottom - r.Top;
            w["bounds"] = bounds;
        }

        w["focused"] = NativeMethods.GetForegroundWindow() == hwnd;
        w["visible"] = true;
        w["minimized"] = false;
        w["maximized"] = false;
        w["fullscreen"] = false;

        return w;
    }

    private static void WalkTree(AutomationElement element, int depth, int maxDepth, List<Dictionary<string, object>> results) {
        if (depth > maxDepth) return;
        try {
            var current = element.Current;
            var info = new Dictionary<string, object>();
            info["name"] = current.Name ?? "";
            info["role"] = current.ControlType != null ? current.ControlType.ProgrammaticName : "";
            info["automationId"] = current.AutomationId ?? "";
            info["className"] = current.ClassName ?? "";

            try {
                int[] rId = element.GetRuntimeId();
                info["runtimeId"] = string.Join(".", rId);
            } catch {
                info["runtimeId"] = "";
            }

            var rect = current.BoundingRectangle;
            info["x"] = (int)rect.X;
            info["y"] = (int)rect.Y;
            info["width"] = (int)rect.Width;
            info["height"] = (int)rect.Height;
            info["isPassword"] = current.IsPassword;
            info["focused"] = current.HasKeyboardFocus;
            info["enabled"] = current.IsEnabled;

            results.Add(info);

            var walker = TreeWalker.RawViewWalker;
            var child = walker.GetFirstChild(element);
            while (child != null) {
                WalkTree(child, depth + 1, maxDepth, results);
                child = walker.GetNextSibling(child);
            }
        } catch {
            // Element might be dead/disposed
        }
    }

    private static Dictionary<string, object> HandleRequest(Dictionary<string, object> req) {
        var res = new Dictionary<string, object>();
        res["success"] = true;

        if (!req.ContainsKey("action")) {
            res["success"] = false;
            res["error"] = "Missing action parameter";
            return res;
        }

        string action = req["action"] as string;
        switch (action) {
            case "get_mouse_position": {
                NativeMethods.POINT p;
                if (NativeMethods.GetCursorPos(out p)) {
                    res["x"] = p.X;
                    res["y"] = p.Y;
                } else {
                    res["success"] = false;
                    res["error"] = "Failed to get cursor position";
                }
                break;
            }
            case "move_mouse": {
                int x = GetInt(req, "x");
                int y = GetInt(req, "y");
                NativeMethods.SetCursorPos(x, y);
                break;
            }
            case "click": {
                string button = GetString(req, "button", "left");
                int clicks = GetInt(req, "clicks", 1);
                int delay = GetInt(req, "delay", 50);

                uint downFlag = 0x0002; // LEFTDOWN
                uint upFlag = 0x0004;   // LEFTUP
                if (button == "right") {
                    downFlag = 0x0008; // RIGHTDOWN
                    upFlag = 0x0010;   // RIGHTUP
                } else if (button == "middle") {
                    downFlag = 0x0020; // MIDDLEDOWN
                    upFlag = 0x0040;   // MIDDLEUP
                }

                for (int i = 0; i < clicks; i++) {
                    if (i > 0) System.Threading.Thread.Sleep(delay);
                    NativeMethods.mouse_event(downFlag, 0, 0, 0, IntPtr.Zero);
                    NativeMethods.mouse_event(upFlag, 0, 0, 0, IntPtr.Zero);
                }
                break;
            }
            case "double_click": {
                string button = GetString(req, "button", "left");
                uint downFlag = 0x0002;
                uint upFlag = 0x0004;
                if (button == "right") {
                    downFlag = 0x0008;
                    upFlag = 0x0010;
                } else if (button == "middle") {
                    downFlag = 0x0020;
                    upFlag = 0x0040;
                }
                NativeMethods.mouse_event(downFlag, 0, 0, 0, IntPtr.Zero);
                NativeMethods.mouse_event(upFlag, 0, 0, 0, IntPtr.Zero);
                System.Threading.Thread.Sleep(50);
                NativeMethods.mouse_event(downFlag, 0, 0, 0, IntPtr.Zero);
                NativeMethods.mouse_event(upFlag, 0, 0, 0, IntPtr.Zero);
                break;
            }
            case "right_click": {
                NativeMethods.mouse_event(0x0008, 0, 0, 0, IntPtr.Zero);
                NativeMethods.mouse_event(0x0010, 0, 0, 0, IntPtr.Zero);
                break;
            }
            case "drag": {
                int fromX = GetInt(req, "fromX");
                int fromY = GetInt(req, "fromY");
                int toX = GetInt(req, "toX");
                int toY = GetInt(req, "toY");
                string button = GetString(req, "button", "left");
                int duration = GetInt(req, "duration", 300);

                uint downFlag = 0x0002;
                uint upFlag = 0x0004;
                if (button == "right") {
                    downFlag = 0x0008;
                    upFlag = 0x0010;
                } else if (button == "middle") {
                    downFlag = 0x0020;
                    upFlag = 0x0040;
                }

                NativeMethods.SetCursorPos(fromX, fromY);
                System.Threading.Thread.Sleep(50);
                NativeMethods.mouse_event(downFlag, 0, 0, 0, IntPtr.Zero);
                System.Threading.Thread.Sleep(duration);
                NativeMethods.SetCursorPos(toX, toY);
                System.Threading.Thread.Sleep(50);
                NativeMethods.mouse_event(upFlag, 0, 0, 0, IntPtr.Zero);
                break;
            }
            case "scroll": {
                int deltaY = GetInt(req, "deltaY", 0);
                int deltaX = GetInt(req, "deltaX", 0);
                if (deltaY != 0) {
                    int amount = deltaY * 120;
                    NativeMethods.mouse_event(0x0800, 0, 0, amount, IntPtr.Zero); // WHEEL
                }
                if (deltaX != 0) {
                    int amount = deltaX * 120;
                    NativeMethods.mouse_event(0x1000, 0, 0, amount, IntPtr.Zero); // HWHEEL
                }
                break;
            }
            case "key_press": {
                byte vk = (byte)GetInt(req, "vk");
                List<string> modifiers = GetStringList(req, "modifiers");
                int delay = GetInt(req, "delay", 0);

                List<byte> modVks = new List<byte>();
                foreach (var mod in modifiers) {
                    modVks.Add(GetModifierVk(mod));
                }

                foreach (var mvk in modVks) {
                    NativeMethods.keybd_event(mvk, 0, 0, IntPtr.Zero);
                }
                NativeMethods.keybd_event(vk, 0, 0, IntPtr.Zero);
                if (delay > 0) System.Threading.Thread.Sleep(delay);
                NativeMethods.keybd_event(vk, 0, 0x0002, IntPtr.Zero); // KEYUP
                for (int i = modVks.Count - 1; i >= 0; i--) {
                    NativeMethods.keybd_event(modVks[i], 0, 0x0002, IntPtr.Zero); // KEYUP
                }
                break;
            }
            case "key_down": {
                byte vk = (byte)GetInt(req, "vk");
                NativeMethods.keybd_event(vk, 0, 0, IntPtr.Zero);
                break;
            }
            case "key_up": {
                byte vk = (byte)GetInt(req, "vk");
                NativeMethods.keybd_event(vk, 0, 0x0002, IntPtr.Zero);
                break;
            }
            case "type": {
                string text = GetString(req, "text", "");
                if (!string.IsNullOrEmpty(text)) {
                    SendKeys.SendWait(text);
                }
                break;
            }
            case "hotkey": {
                List<string> keys = GetStringList(req, "keys");
                List<string> modifiers = GetStringList(req, "modifiers");

                List<byte> modVks = new List<byte>();
                foreach (var mod in modifiers) {
                    modVks.Add(GetModifierVk(mod));
                }

                foreach (var mvk in modVks) {
                    NativeMethods.keybd_event(mvk, 0, 0, IntPtr.Zero);
                }
                foreach (var keyStr in keys) {
                    byte vk = (byte)Convert.ToInt32(keyStr);
                    NativeMethods.keybd_event(vk, 0, 0, IntPtr.Zero);
                    NativeMethods.keybd_event(vk, 0, 0x0002, IntPtr.Zero);
                }
                for (int i = modVks.Count - 1; i >= 0; i--) {
                    NativeMethods.keybd_event(modVks[i], 0, 0x0002, IntPtr.Zero);
                }
                break;
            }
            case "get_active_window": {
                IntPtr fg = NativeMethods.GetForegroundWindow();
                if (fg != IntPtr.Zero) {
                    res["window"] = GetWindowInfo(fg);
                } else {
                    res["window"] = null;
                }
                break;
            }
            case "get_windows": {
                var windows = new List<Dictionary<string, object>>();
                foreach (var proc in Process.GetProcesses()) {
                    if (proc.MainWindowHandle != IntPtr.Zero) {
                        var w = new Dictionary<string, object>();
                        w["handle"] = proc.MainWindowHandle.ToInt64().ToString();
                        w["title"] = proc.MainWindowTitle ?? "";
                        w["pid"] = proc.Id;
                        w["processName"] = proc.ProcessName ?? "";

                        NativeMethods.RECT r;
                        if (NativeMethods.GetWindowRect(proc.MainWindowHandle, out r)) {
                            var bounds = new Dictionary<string, object>();
                            bounds["x"] = r.Left;
                            bounds["y"] = r.Top;
                            bounds["width"] = r.Right - r.Left;
                            bounds["height"] = r.Bottom - r.Top;
                            w["bounds"] = bounds;
                        }

                        w["focused"] = NativeMethods.GetForegroundWindow() == proc.MainWindowHandle;
                        w["visible"] = true;
                        w["minimized"] = false;
                        w["maximized"] = false;
                        w["fullscreen"] = false;
                        windows.Add(w);
                    }
                }
                res["windows"] = windows;
                break;
            }
            case "get_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                res["window"] = GetWindowInfo(hwnd);
                break;
            }
            case "focus_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                NativeMethods.SetForegroundWindow(hwnd);
                break;
            }
            case "minimize_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                NativeMethods.ShowWindow(hwnd, 6);
                break;
            }
            case "maximize_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                NativeMethods.ShowWindow(hwnd, 3);
                break;
            }
            case "restore_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                NativeMethods.ShowWindow(hwnd, 9);
                break;
            }
            case "close_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);
                NativeMethods.SendMessage(hwnd, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                break;
            }
            case "set_window": {
                long handleVal = Convert.ToInt64(req["handle"]);
                IntPtr hwnd = new IntPtr(handleVal);

                NativeMethods.RECT r;
                NativeMethods.GetWindowRect(hwnd, out r);
                int currentX = r.Left;
                int currentY = r.Top;
                int currentWidth = r.Right - r.Left;
                int currentHeight = r.Bottom - r.Top;

                if (req.ContainsKey("position")) {
                    var pos = req["position"] as Dictionary<string, object>;
                    if (pos != null) {
                        currentX = GetInt(pos, "x", currentX);
                        currentY = GetInt(pos, "y", currentY);
                    }
                }
                if (req.ContainsKey("size")) {
                    var sz = req["size"] as Dictionary<string, object>;
                    if (sz != null) {
                        currentWidth = GetInt(sz, "width", currentWidth);
                        currentHeight = GetInt(sz, "height", currentHeight);
                    }
                }

                NativeMethods.MoveWindow(hwnd, currentX, currentY, currentWidth, currentHeight, true);

                if (GetBool(req, "focus")) {
                    NativeMethods.SetForegroundWindow(hwnd);
                }
                break;
            }
            case "get_running_apps": {
                var apps = new List<Dictionary<string, object>>();
                foreach (var proc in Process.GetProcesses()) {
                    if (proc.MainWindowHandle != IntPtr.Zero) {
                        var app = new Dictionary<string, object>();
                        app["name"] = proc.ProcessName ?? "";
                        try {
                            app["path"] = proc.MainModule.FileName ?? "";
                        } catch {
                            app["path"] = "";
                        }
                        app["pid"] = proc.Id;
                        app["running"] = true;
                        apps.Add(app);
                    }
                }
                res["apps"] = apps;
                break;
            }
            case "launch_app": {
                string path = GetString(req, "path");
                string args = GetString(req, "args", "");
                string cwd = GetString(req, "cwd", "");
                bool hidden = GetBool(req, "hidden", false);

                var psi = new ProcessStartInfo(path, args);
                if (!string.IsNullOrEmpty(cwd)) {
                    psi.WorkingDirectory = cwd;
                }
                if (hidden) {
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    psi.CreateNoWindow = true;
                }

                var proc = Process.Start(psi);
                var appInfo = new Dictionary<string, object>();
                appInfo["name"] = proc != null ? proc.ProcessName : path;
                appInfo["path"] = path;
                appInfo["pid"] = proc != null ? proc.Id : 0;
                appInfo["running"] = proc != null;
                res["app"] = appInfo;
                break;
            }
            case "close_app": {
                int pid = GetInt(req, "pid");
                var proc = Process.GetProcessById(pid);
                if (proc != null) {
                    proc.Kill();
                }
                break;
            }
            case "get_screens": {
                var screens = new List<Dictionary<string, object>>();
                var allScreens = Screen.AllScreens;
                for (int i = 0; i < allScreens.Length; i++) {
                    var s = allScreens[i];
                    var scr = new Dictionary<string, object>();
                    scr["id"] = i;
                    scr["name"] = s.DeviceName ?? "";

                    var bounds = new Dictionary<string, object>();
                    bounds["x"] = s.Bounds.X;
                    bounds["y"] = s.Bounds.Y;
                    bounds["width"] = s.Bounds.Width;
                    bounds["height"] = s.Bounds.Height;
                    scr["bounds"] = bounds;

                    var workArea = new Dictionary<string, object>();
                    workArea["x"] = s.WorkingArea.X;
                    workArea["y"] = s.WorkingArea.Y;
                    workArea["width"] = s.WorkingArea.Width;
                    workArea["height"] = s.WorkingArea.Height;
                    scr["workArea"] = workArea;

                    scr["scaleFactor"] = 1.0;
                    scr["primary"] = s.Primary;
                    screens.Add(scr);
                }
                res["screens"] = screens;
                break;
            }
            case "get_pixel_color": {
                int x = GetInt(req, "x");
                int y = GetInt(req, "y");
                using (var bmp = new Bitmap(1, 1)) {
                    using (var g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(x, y, 0, 0, new Size(1, 1));
                    }
                    var c = bmp.GetPixel(0, 0);
                    res["r"] = (int)c.R;
                    res["g"] = (int)c.G;
                    res["b"] = (int)c.B;
                    res["a"] = (int)c.A;
                    res["hex"] = string.Format("#{0:x2}{1:x2}{2:x2}", c.R, c.G, c.B);
                }
                break;
            }
            case "get_clipboard": {
                if (Clipboard.ContainsText()) {
                    res["text"] = Clipboard.GetText();
                    res["formats"] = new List<string> { "text" };
                } else {
                    res["text"] = null;
                    res["formats"] = new List<string>();
                }
                break;
            }
            case "set_clipboard": {
                string text = GetString(req, "text", "");
                Clipboard.SetText(text);
                break;
            }
            case "clear_clipboard": {
                Clipboard.Clear();
                break;
            }
            case "get_uia_tree": {
                long handleVal = req.ContainsKey("handle") ? Convert.ToInt64(req["handle"]) : 0;
                IntPtr hwnd = new IntPtr(handleVal);
                int maxDepth = GetInt(req, "maxDepth", 5);

                AutomationElement root = null;
                if (hwnd != IntPtr.Zero) {
                    try {
                        root = AutomationElement.FromHandle(hwnd);
                    } catch {}
                }

                if (root == null) {
                    try {
                        root = AutomationElement.FocusedElement;
                        if (root != null) {
                            var walker = TreeWalker.RawViewWalker;
                            var parent = walker.GetParent(root);
                            while (parent != null && parent.Current.ControlType != ControlType.Window) {
                                parent = walker.GetParent(parent);
                            }
                            if (parent != null) root = parent;
                        }
                    } catch {}
                }

                if (root == null) {
                    try {
                        IntPtr activeHwnd = NativeMethods.GetForegroundWindow();
                        if (activeHwnd != IntPtr.Zero) {
                            root = AutomationElement.FromHandle(activeHwnd);
                        }
                    } catch {}
                }

                if (root == null) {
                    root = AutomationElement.RootElement;
                }

                var results = new List<Dictionary<string, object>>();
                if (root != null) {
                    WalkTree(root, 0, maxDepth, results);
                }
                res["elements"] = results;
                break;
            }
            default: {
                res["success"] = false;
                res["error"] = "Unknown action: " + action;
                break;
            }
        }
        return res;
    }
}
