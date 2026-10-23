using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class UpdateInfo { public string version; public string nextVersion; }
public sealed class WindowBounds { public int x; public int y; public int width; public int height; }
public sealed class Configuration {
    public string name; public int protocol; public string root; public string statusFile;
    public string executable; public string language; public string[] args;
    public bool maximized; public WindowBounds bounds; public UpdateInfo update;
    public Dictionary<string,string> labels;
}

internal static class Program {
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [STAThread] private static void Main() {
        try {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { SetProcessDPIAware(); }
            string root=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            Configuration config=new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(Path.Combine(root,"config.json"),Encoding.UTF8));
            if(config.name!="archi-update-helper" || config.protocol!=2 || !String.Equals(Path.GetFullPath(config.root).TrimEnd(Path.DirectorySeparatorChar),root.TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase))return;
            string identity;using(SHA256 hash=SHA256.Create())identity=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root))).Replace("-","");
            bool owner;using(Mutex mutex=new Mutex(true,"Local\\ArchiHelperUpdate-"+identity,out owner)) {
                if(!owner)return;
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new UpdateWindow(config));
            }
        } catch(Exception error) { MessageBox.Show(error.Message,"Archi Helper",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    }
}

internal sealed class ProgressTrack:Control {
    private int position;private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    public ProgressTrack() {
        SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
        AccessibleRole=AccessibleRole.ProgressBar;Height=6;timer.Interval=40;
        timer.Tick+=delegate{position=(position+7)%Math.Max(1,Width+Width/3);Invalidate();};timer.Start();
    }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);e.Graphics.Clear(Color.FromArgb(228,233,221));
        using(Brush brush=new SolidBrush(Color.FromArgb(95,120,80)))e.Graphics.FillRectangle(brush,position-Width/3,0,Width/3,Height);
    }
    protected override void Dispose(bool disposing) {if(disposing)timer.Dispose();base.Dispose(disposing);}
}

internal sealed class PixelLogo:Control {
    public Image Image;
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);if(Image==null)return;
        e.Graphics.InterpolationMode=InterpolationMode.NearestNeighbor;e.Graphics.PixelOffsetMode=PixelOffsetMode.Half;
        e.Graphics.DrawImage(Image,ClientRectangle);
    }
    protected override void Dispose(bool disposing){if(disposing&&Image!=null)Image.Dispose();base.Dispose(disposing);}
}

internal sealed class UpdateWindow:Form {
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle,int command);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle,int message,IntPtr wParam,IntPtr lParam);
    private readonly Configuration config;private readonly JavaScriptSerializer json=new JavaScriptSerializer();
    private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    private readonly Panel card=new Panel();private readonly Label title=new Label(),description=new Label(),steps=new Label(),version=new Label();
    private readonly Button reopen=new Button(),close=new Button();private readonly ProgressTrack progress=new ProgressTrack();
    private readonly DateTime started=DateTime.UtcNow;private DateTime launched;private Process application;
    private string stage="preparing";private bool canClose,ready,launching,applied;
    public UpdateWindow(Configuration value) {
        config=value;Text="Archi Helper";BackColor=Color.FromArgb(252,252,249);ForeColor=Color.FromArgb(41,49,37);
        Font=new Font("Segoe UI",10);FormBorderStyle=FormBorderStyle.None;MinimumSize=new Size(1000,680);StartPosition=FormStartPosition.Manual;
        if(config.bounds!=null)Bounds=new Rectangle(config.bounds.x,config.bounds.y,Math.Max(1000,config.bounds.width),Math.Max(680,config.bounds.height));else Size=new Size(1200,800);
        Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Label brand=new Label();brand.Text="Archi Helper";brand.Location=new Point(22,19);brand.AutoSize=true;brand.Font=new Font(Font.FontFamily,12,FontStyle.Bold);Controls.Add(brand);
        brand.MouseDown+=delegate{ReleaseCapture();SendMessage(Handle,0xA1,new IntPtr(2),IntPtr.Zero);};
        Button minimize=WindowButton("\u2212");minimize.Click+=delegate{WindowState=FormWindowState.Minimized;};Controls.Add(minimize);
        close.Text="\u00d7";StyleWindowButton(close);close.Visible=false;close.Click+=delegate{canClose=true;Close();};Controls.Add(close);
        Resize+=delegate{minimize.Location=new Point(ClientSize.Width-94,10);close.Location=new Point(ClientSize.Width-48,10);card.Location=new Point((ClientSize.Width-card.Width)/2,(ClientSize.Height-card.Height)/2);};
        card.Size=new Size(580,402);Controls.Add(card);
        PixelLogo logo=new PixelLogo();logo.Image=Icon.ToBitmap();logo.Bounds=new Rectangle(210,-12,160,160);card.Controls.Add(logo);
        title.Bounds=new Rectangle(0,145,580,70);title.Font=new Font(Font.FontFamily,21,FontStyle.Bold);title.TextAlign=ContentAlignment.MiddleCenter;card.Controls.Add(title);
        description.Bounds=new Rectangle(45,218,490,58);description.ForeColor=Color.FromArgb(104,110,98);description.TextAlign=ContentAlignment.MiddleCenter;card.Controls.Add(description);
        progress.Bounds=new Rectangle(60,296,460,6);card.Controls.Add(progress);
        steps.Bounds=new Rectangle(45,315,490,24);steps.TextAlign=ContentAlignment.MiddleCenter;steps.ForeColor=Color.FromArgb(95,120,80);card.Controls.Add(steps);
        version.Bounds=new Rectangle(45,351,490,20);version.TextAlign=ContentAlignment.MiddleCenter;version.ForeColor=Color.FromArgb(130,136,123);version.Font=new Font(Font.FontFamily,9);version.Text=(config.update.version??"")+"  \u2192  "+(config.update.nextVersion??"");card.Controls.Add(version);
        reopen.Text=Label("reopen");reopen.AutoSize=true;reopen.FlatStyle=FlatStyle.Flat;reopen.FlatAppearance.BorderColor=Color.FromArgb(95,120,80);reopen.BackColor=Color.FromArgb(95,120,80);reopen.ForeColor=Color.White;reopen.Padding=new Padding(12,6,12,6);reopen.Visible=false;
        reopen.Click+=delegate{Restart(Read(config.statusFile)=="complete");};card.Controls.Add(reopen);
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(!canClose&&stage!="error"&&e.CloseReason!=CloseReason.WindowsShutDown)e.Cancel=true;};
        Shown+=delegate{if(config.maximized)WindowState=FormWindowState.Maximized;EnsureVisible();};
        timer.Interval=150;timer.Tick+=Tick;timer.Start();Publish("preparing");
        minimize.Location=new Point(ClientSize.Width-94,10);close.Location=new Point(ClientSize.Width-48,10);
        card.Location=new Point((ClientSize.Width-card.Width)/2,(ClientSize.Height-card.Height)/2);
    }
    private Button WindowButton(string text) {Button button=new Button();button.Text=text;StyleWindowButton(button);return button;}
    private void StyleWindowButton(Button button){button.Size=new Size(40,32);button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderSize=0;button.BackColor=BackColor;button.TabStop=false;}
    private string Label(string key){string value;return config.labels!=null&&config.labels.TryGetValue(key,out value)?value:key;}
    private static string Read(string file){try{return File.ReadAllText(file,Encoding.UTF8).Trim();}catch{return "";}}
    private void EnsureVisible(){if(IsWindowVisible(Handle))return;ShowWindow(Handle,0);ShowWindow(Handle,WindowState==FormWindowState.Maximized?3:1);}
    private void Publish(string next) {
        stage=next;title.Text=Label(next+"Title");description.Text=Label(next+"Description");
        bool error=next=="error";progress.Visible=!error;steps.Visible=!error;reopen.Visible=error;close.Visible=error;
        steps.Text=Label("install")+"    \u2192    "+Label("launch");reopen.Location=new Point((card.Width-reopen.Width)/2,292);
    }
    private void Tick(object sender,EventArgs args) {
        if(!ready){EnsureVisible();if(IsWindowVisible(Handle)){File.WriteAllText(Path.Combine(config.root,"helper-ready.json"),json.Serialize(new {pid=Process.GetCurrentProcess().Id,protocol=2}),new UTF8Encoding(false));ready=true;}}
        if(File.Exists(Path.Combine(config.root,"abort"))){canClose=true;Close();return;}
        string confirmation=Read(Path.Combine(config.root,"app-ready.json"));
        if(confirmation.Length>0)try{Dictionary<string,object> info=json.Deserialize<Dictionary<string,object>>(confirmation);object versionValue;if(info.TryGetValue("version",out versionValue)&&(!applied||Convert.ToString(versionValue)==config.update.nextVersion)){canClose=true;Close();return;}}catch{}
        if(launching){if((application!=null&&application.HasExited)||(DateTime.UtcNow-launched).TotalSeconds>60){launching=false;Publish("error");}return;}
        if(stage=="error")return;
        string status=Read(config.statusFile);
        if(status=="complete")Restart(true);
        else if(status=="error"||(DateTime.UtcNow-started).TotalMinutes>20)Publish("error");
        else if(status=="applying"&&stage!="applying")Publish("applying");
    }
    private static string Quote(string value) {
        StringBuilder result=new StringBuilder("\"");int slashes=0;
        foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
        result.Append('\\',slashes*2);return result.Append('"').ToString();
    }
    private void Restart(bool installed) {
        if(launching)return;launching=true;applied=installed;launched=DateTime.UtcNow;Publish(installed?"restarting":"reopening");
        try {
            List<string> args=new List<string>(config.args??new string[0]);if(installed)args.Add("--updated");
            ProcessStartInfo start=new ProcessStartInfo(config.executable,String.Join(" ",args.ConvertAll(Quote).ToArray()));start.WorkingDirectory=Path.GetDirectoryName(config.executable);start.UseShellExecute=false;
            start.EnvironmentVariables["ARCHI_UPDATE_HELPER_DIR"]=config.root;start.EnvironmentVariables.Remove("ARCHI_UPDATE_STATUS_FILE");start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            application=Process.Start(start);
        } catch {launching=false;Publish("error");}
    }
    protected override void Dispose(bool disposing){if(disposing){timer.Dispose();if(application!=null)application.Dispose();}base.Dispose(disposing);}
}
