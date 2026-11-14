using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace BridgeDesktop
{
    class Program
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool OpenClipboard(IntPtr hWnd);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseClipboard();
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool EmptyClipboard();
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr GetClipboardData(uint uFormat);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GlobalLock(IntPtr hMem);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GlobalUnlock(IntPtr hMem);

        public const uint CF_UNICODETEXT = 13;
        public const uint GMEM_MOVEABLE = 0x0002;

        public static bool SetClipboardText(string text)
        {
            if (text == null) text = "";
            byte[] bytes = System.Text.Encoding.Unicode.GetBytes(text + "\0");
            for (int i = 0; i < 30; i++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        EmptyClipboard();
                        IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                        if (hGlobal == IntPtr.Zero) return false;
                        IntPtr pGlobal = GlobalLock(hGlobal);
                        Marshal.Copy(bytes, 0, pGlobal, bytes.Length);
                        GlobalUnlock(hGlobal);
                        SetClipboardData(CF_UNICODETEXT, hGlobal);
                        return true;
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(30);
            }
            return false;
        }

        public static string GetClipboardText()
        {
            for (int i = 0; i < 30; i++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        IntPtr handle = GetClipboardData(CF_UNICODETEXT);
                        if (handle == IntPtr.Zero) return "";
                        IntPtr pGlobal = GlobalLock(handle);
                        if (pGlobal == IntPtr.Zero) return "";
                        try
                        {
                            return Marshal.PtrToStringUni(pGlobal);
                        }
                        finally
                        {
                            GlobalUnlock(handle);
                        }
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(30);
            }
            return "";
        }

        [STAThread]
        static int Main(string[] args)
        {
            if (args.Length == 0)
            {
                Console.WriteLine("Usage: bridge_native.exe <screenshot|get-clipboard|set-clipboard|paste-clipboard> [args...]");
                return 1;
            }

            string cmd = args[0].ToLowerInvariant();
            try
            {
                if (cmd == "screenshot" || cmd == "peek")
                {
                    int maxWidth = 1024;
                    int quality = 65;
                    if (args.Length > 1) int.TryParse(args[1], out maxWidth);
                    if (args.Length > 2) int.TryParse(args[2], out quality);
                    if (maxWidth <= 0) maxWidth = 1024;
                    if (quality <= 0 || quality > 100) quality = 65;

                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height))
                    {
                        using (Graphics g = Graphics.FromImage(bmp))
                        {
                            g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                        }

                        double scale = Math.Min(1.0, (double)maxWidth / bounds.Width);
                        int newW = (int)(bounds.Width * scale);
                        int newH = (int)(bounds.Height * scale);

                        using (Bitmap resized = new Bitmap(newW, newH))
                        {
                            using (Graphics rg = Graphics.FromImage(resized))
                            {
                                rg.InterpolationMode = InterpolationMode.Bilinear;
                                rg.DrawImage(bmp, 0, 0, newW, newH);
                            }

                            ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
                            EncoderParameters encoderParams = new EncoderParameters(1);
                            encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);

                            using (MemoryStream ms = new MemoryStream())
                            {
                                if (jpegEncoder != null)
                                {
                                    resized.Save(ms, jpegEncoder, encoderParams);
                                }
                                else
                                {
                                    resized.Save(ms, ImageFormat.Jpeg);
                                }
                                string b64 = Convert.ToBase64String(ms.ToArray());
                                Console.Write(b64);
                            }
                        }
                    }
                    return 0;
                }
                else if (cmd == "get-clipboard")
                {
                    string txt = GetClipboardText();
                    Console.Write(txt);
                    return 0;
                }
                else if (cmd == "set-clipboard")
                {
                    string text = "";
                    if (args.Length > 1)
                    {
                        text = string.Join(" ", args, 1, args.Length - 1);
                    }
                    else
                    {
                        using (StreamReader reader = new StreamReader(Console.OpenStandardInput()))
                        {
                            text = reader.ReadToEnd();
                        }
                    }
                    bool ok = SetClipboardText(text);
                    Console.Write(ok ? "OK" : "ERR");
                    return ok ? 0 : 1;
                }
                else if (cmd == "paste-clipboard")
                {
                    SendKeys.SendWait("^v");
                    Console.Write("OK");
                    return 0;
                }
                else
                {
                    Console.WriteLine("Unknown command: " + cmd);
                    return 1;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.ToString());
                return 1;
            }
        }

        private static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid)
                {
                    return codec;
                }
            }
            return null;
        }
    }
}
