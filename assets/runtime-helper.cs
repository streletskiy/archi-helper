using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

public sealed class RuntimeFile { public string path; public long size; public string sha256; }
public sealed class RuntimeManifest { public int schema; public RuntimeFile[] files; }

internal static class RuntimeHelper {
    private static string progressPath,progressStage;
    private static readonly Stopwatch elapsed=Stopwatch.StartNew();
    private static long lastReport=-1000;
    private static void Report(int complete,int total) {
        if(String.IsNullOrEmpty(progressPath)||total<=0)return;
        if(complete!=total&&elapsed.ElapsedMilliseconds-lastReport<200)return;
        lastReport=elapsed.ElapsedMilliseconds;
        try {
            double remaining=complete>0&&elapsed.Elapsed.TotalSeconds>=1?elapsed.Elapsed.TotalSeconds*(total-complete)/complete:-1;
            string text=new JavaScriptSerializer().Serialize(new {stage=progressStage,percent=100.0*complete/total,files=complete,totalFiles=total,secondsRemaining=remaining});
            string temporary=progressPath+".tmp";
            File.WriteAllText(temporary,text);
            if(File.Exists(progressPath))File.Replace(temporary,progressPath,null);else File.Move(temporary,progressPath);
        } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
    private static bool IsLink(string path) {return (File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0;}
    private static string Digest(string path) {
        using(FileStream file=File.OpenRead(path))using(SHA256 hash=SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(file)).Replace("-","").ToLowerInvariant();
    }
    private static bool Verify(string manifestPath,string directory) {
        string root=Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        if(!Directory.Exists(root)||IsLink(root))return false;
        JavaScriptSerializer json=new JavaScriptSerializer();json.MaxJsonLength=16*1024*1024;
        RuntimeManifest manifest=json.Deserialize<RuntimeManifest>(File.ReadAllText(manifestPath));
        if(manifest.schema!=1||manifest.files==null||manifest.files.Length==0)return false;
        Report(0,manifest.files.Length);
        Dictionary<string,RuntimeFile> expected=new Dictionary<string,RuntimeFile>(StringComparer.OrdinalIgnoreCase);
        foreach(RuntimeFile entry in manifest.files) {
            if(String.IsNullOrEmpty(entry.path)||Path.IsPathRooted(entry.path)||entry.path.IndexOf(':')>=0)return false;
            string file=Path.GetFullPath(Path.Combine(root,entry.path.Replace('/',Path.DirectorySeparatorChar)));
            if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase)||expected.ContainsKey(file))return false;
            expected.Add(file,entry);
        }
        List<KeyValuePair<string,RuntimeFile>> matched=new List<KeyValuePair<string,RuntimeFile>>();
        Stack<DirectoryInfo> pending=new Stack<DirectoryInfo>();pending.Push(new DirectoryInfo(root));
        while(pending.Count>0) {
            foreach(FileSystemInfo info in pending.Pop().EnumerateFileSystemInfos()) {
                if((info.Attributes&FileAttributes.ReparsePoint)!=0)return false;
                if((info.Attributes&FileAttributes.Directory)!=0){pending.Push((DirectoryInfo)info);continue;}
                string item=info.FullName;
                RuntimeFile entry;
                if(!expected.TryGetValue(item,out entry)) {
                    // CPython creates disposable caches during normal execution.
                    if(Path.GetFileName(Path.GetDirectoryName(item))=="__pycache__"&&Path.GetExtension(item)==".pyc")continue;
                    return false;
                }
                if(((FileInfo)info).Length!=entry.size)return false;
                matched.Add(new KeyValuePair<string,RuntimeFile>(item,entry));
                expected.Remove(item);
            }
        }
        // Reject missing files before reading thousands of file contents. This
        // keeps migration from incomplete legacy installations inexpensive.
        if(expected.Count!=0)return false;
        int complete=0;
        foreach(KeyValuePair<string,RuntimeFile> item in matched) {
            if(!String.Equals(Digest(item.Key),item.Value.sha256,StringComparison.OrdinalIgnoreCase))return false;
            Report(++complete,matched.Count);
        }
        return true;
    }
    private static int Main(string[] args) {
        try {
            if(args.Length!=3&&args.Length!=5)return 1;
            if(args.Length==5){progressPath=args[3];progressStage=args[4];}
            return args[0]=="verify"&&Verify(args[1],args[2])?0:1;
        }
        catch {return 1;}
    }
}
