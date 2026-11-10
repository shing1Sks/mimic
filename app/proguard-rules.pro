# R8 rules for release builds.
#
# Settings persists enum constants by name (theme, modes, grip-card counters), so the names must
# survive shrinking or an update would silently reset those preferences.
-keepclassmembers,allowoptimization enum dev.mimic.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
    <fields>;
}
-keepnames enum dev.mimic.** { *; }

# Keep line numbers for readable crash reports, hide the original source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
