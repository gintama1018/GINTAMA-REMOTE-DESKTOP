using System;
using System.Runtime.InteropServices;

class VolumeControl
{
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: volume_control.exe <0-100 | mute | get | up | down>");
            return 1;
        }

        try
        {
            IMMDeviceEnumerator deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice speakers = null;
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out speakers);

            Guid iidAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
            object objAepv = null;
            speakers.Activate(ref iidAudioEndpointVolume, CLSCTX.CLSCTX_ALL, IntPtr.Zero, out objAepv);
            IAudioEndpointVolume endpointVolume = (IAudioEndpointVolume)objAepv;

            string cmd = args[0].ToLowerInvariant().Trim();

            if (cmd == "mute")
            {
                bool isMuted = false;
                endpointVolume.GetMute(out isMuted);
                endpointVolume.SetMute(!isMuted, Guid.Empty);
                Console.WriteLine("MUTE:" + (!isMuted ? "ON" : "OFF"));
                return 0;
            }

            if (cmd == "get")
            {
                float curVol = 0f;
                bool isMuted = false;
                endpointVolume.GetMasterVolumeLevelScalar(out curVol);
                endpointVolume.GetMute(out isMuted);
                int pct = (int)Math.Round(curVol * 100);
                Console.WriteLine("VOLUME:" + pct + ";MUTE:" + (isMuted ? "ON" : "OFF"));
                return 0;
            }

            if (cmd == "up")
            {
                endpointVolume.VolumeStepUp(Guid.Empty);
                float v = 0f;
                endpointVolume.GetMasterVolumeLevelScalar(out v);
                Console.WriteLine("VOLUME:" + (int)Math.Round(v * 100));
                return 0;
            }

            if (cmd == "down")
            {
                endpointVolume.VolumeStepDown(Guid.Empty);
                float v = 0f;
                endpointVolume.GetMasterVolumeLevelScalar(out v);
                Console.WriteLine("VOLUME:" + (int)Math.Round(v * 100));
                return 0;
            }

            float parsed = 0f;
            if (float.TryParse(cmd, out parsed))
            {
                float clamped = Math.Max(0f, Math.Min(100f, parsed));
                float scalar = clamped / 100f;
                endpointVolume.SetMasterVolumeLevelScalar(scalar, Guid.Empty);
                if (clamped > 0)
                {
                    endpointVolume.SetMute(false, Guid.Empty);
                }
                Console.WriteLine("VOLUME:" + (int)clamped);
                return 0;
            }

            Console.WriteLine("Invalid argument");
            return 1;
        }
        catch (Exception ex)
        {
            Console.WriteLine("ERROR: " + ex.Message);
            return 2;
        }
    }
}

#region COM Definitions
[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator { }

internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
internal enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }
internal class CLSCTX { public const int CLSCTX_ALL = 23; }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoints(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
    int GetDevice(string pwstrId, out IMMDevice ppPage);
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid riid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    int VolumeStepUp(Guid pguidEventContext);
    int VolumeStepDown(Guid pguidEventContext);
    int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    int GetVolumeRange(out float pfLevelMinDB, out float pfLevelMaxDB, out float pfLevelIncrementDB);
}
#endregion
