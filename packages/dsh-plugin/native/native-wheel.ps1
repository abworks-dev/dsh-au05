param(
  [ValidateSet('SelfTest','Listen')][string]$Mode = 'SelfTest',
  [string]$ExpectedExe = ''
)
$ErrorActionPreference = 'Stop'
# SelfTest compiles and exercises only pure/fake delegates; never hooks or calls SendInput.
$source = @'
using System;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
public static class DshNativeWheel {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] inputs,int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder text,ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
  static IntPtr boundWindow = IntPtr.Zero; static uint boundPid;
  public static string Execute(string direction,long deadline,Func<string> guard,Func<int,bool> send,Func<long> clock) {
    if(direction!="up" && direction!="down") return "invalid_request";
    if(deadline<=clock() || deadline-clock()>500) return "expired";
    string failure=guard(); if(failure!=null) return failure;
    if(deadline<=clock()) return "expired";
    failure=guard(); if(failure!=null) return failure;
    if(deadline<=clock()) return "expired";
    return send(direction=="up"?120:-120)?null:"input_failed";
  }
  static string Guard(string expected,IntPtr initial,uint initialPid) {
    IntPtr hwnd=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(hwnd,out pid);
    if(hwnd==IntPtr.Zero || hwnd!=initial || pid!=initialPid || (boundWindow!=IntPtr.Zero && (hwnd!=boundWindow || pid!=boundPid))) return "foreground_mismatch";
    IntPtr process=OpenProcess(0x1000,false,pid); if(process==IntPtr.Zero) return "foreground_mismatch";
    try { var path=new StringBuilder(32768); int length=path.Capacity; if(!QueryFullProcessImageName(process,0,path,ref length) || !String.Equals(path.ToString(),expected,StringComparison.OrdinalIgnoreCase)) return "foreground_mismatch"; }
    finally { CloseHandle(process); }
    POINT point; RECT rect;
    if(!GetCursorPos(out point) || GetAncestor(WindowFromPoint(point),2)!=hwnd || !ScreenToClient(hwnd,ref point) || !GetClientRect(hwnd,out rect) || point.X<rect.Left || point.Y<rect.Top || point.X>=rect.Right || point.Y>=rect.Bottom) return "pointer_mismatch";
    foreach(int key in new int[]{0x10,0x11,0x12,0x5B,0x5C,0xA0,0xA1,0xA2,0xA3,0xA4,0xA5}) if((GetAsyncKeyState(key)&0x8000)!=0) return "modifiers_down";
    // Recheck identity after the path/pointer queries, immediately before returning to sender.
    uint finalPid; IntPtr final=GetForegroundWindow(); GetWindowThreadProcessId(final,out finalPid);
    if(final!=hwnd || finalPid!=pid) return "foreground_mismatch";
    return null;
  }
  static bool Send(int delta) {
    var input=new INPUT {type=0,mi=new MOUSEINPUT {mouseData=unchecked((uint)delta),dwFlags=0x0800}};
    return SendInput(1,new INPUT[]{input},Marshal.SizeOf(typeof(INPUT)))==1;
  }
  static string ReadBounded() {
    var line=new StringBuilder(); int c;
    while((c=Console.In.Read())!=-1) { if(c==10) return line.ToString().TrimEnd('\r'); if(line.Length>=256) throw new Exception(); line.Append((char)c); }
    if(line.Length!=0) throw new Exception(); return null;
  }
  public static void Listen(string expected) {
    if(String.IsNullOrEmpty(expected) || !System.IO.Path.IsPathFullyQualified(expected)) return;
    Console.WriteLine("{\"type\":\"ready\"}"); Console.Out.Flush(); long lastId=0;
    try { string line; while((line=ReadBounded())!=null) {
      using(var doc=JsonDocument.Parse(line)) {
        var root=doc.RootElement; if(root.ValueKind!=JsonValueKind.Object) return;
        int count=0; foreach(var property in root.EnumerateObject()) { count++; if(property.Name!="type" && property.Name!="id" && property.Name!="direction" && property.Name!="deadline") return; }
        JsonElement t,i,d,e;
        if(count!=4 || !root.TryGetProperty("type",out t) || t.GetString()!="wheel" || !root.TryGetProperty("id",out i) || !root.TryGetProperty("direction",out d) || !root.TryGetProperty("deadline",out e)) return;
        long id,deadline; if(!i.TryGetInt64(out id) || id<=lastId || id>9007199254740991L || !e.TryGetInt64(out deadline) || deadline<0 || deadline>9007199254740991L || d.ValueKind!=JsonValueKind.String) return;
        string direction=d.GetString(); if(direction!="up" && direction!="down") return; lastId=id;
        IntPtr hwnd=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(hwnd,out pid);
        string error=Execute(direction,deadline,()=>Guard(expected,hwnd,pid),delta=>{
          string final=Guard(expected,hwnd,pid); if(final!=null || Now()>=deadline) return false;
          if(boundWindow==IntPtr.Zero) {boundWindow=hwnd;boundPid=pid;}
          return Send(delta);
        },Now);
        Console.WriteLine("{\"type\":\"result\",\"id\":"+id+",\"scrolled\":"+(error==null?"true":"false")+",\"error\":"+(error==null?"null":"\""+error+"\"")+"}"); Console.Out.Flush();
      }
    }} catch { /* No raw exceptions, paths, window text or private data on protocol. */ }
  }
  public static void SelfTest() {
    int calls=0,delta=0; Func<int,bool> fake=x=>{calls++;delta=x;return true;}; Func<long> clock=()=>1000;
    if(Execute("up",1400,()=>null,fake,clock)!=null || delta!=120) throw new Exception("selftest");
    if(Execute("down",1400,()=>null,fake,clock)!=null || delta!=-120) throw new Exception("selftest");
    foreach(string failure in new[]{"foreground_mismatch","pointer_mismatch","modifiers_down"}) if(Execute("up",1400,()=>failure,fake,clock)!=failure) throw new Exception("selftest");
    if(Execute("up",1000,()=>null,fake,clock)!="expired" || Execute("other",1400,()=>null,fake,clock)!="invalid_request" || calls!=2) throw new Exception("selftest");
    int checks=0; if(Execute("up",1400,()=>++checks==2?"foreground_mismatch":null,fake,clock)!="foreground_mismatch" || calls!=2) throw new Exception("selftest");
    long tick=1000; if(Execute("up",1400,()=>{tick=1400;return null;},fake,()=>tick)!="expired" || calls!=2) throw new Exception("selftest");
    if(Execute("up",1501,()=>null,fake,clock)!="expired" || calls!=2) throw new Exception("selftest");
    if(Execute("up",1400,()=>null,x=>false,clock)!="input_failed") throw new Exception("selftest");
  }
}
'@
try {
  Add-Type -TypeDefinition $source -ErrorAction Stop
  if ($Mode -eq 'SelfTest') { [DshNativeWheel]::SelfTest(); '{"type":"selftest","ok":true}' }
  else { [DshNativeWheel]::Listen($ExpectedExe) }
} catch { exit 1 }
