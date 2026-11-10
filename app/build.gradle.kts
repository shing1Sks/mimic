import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// One place to bump for a release (see docs/releasing.md). versionCode is derived from it:
// MAJOR * 10000 + MINOR * 100 + PATCH, so 0.2.0 -> 200, 1.4.12 -> 10412. MINOR and PATCH stay below 100.
val mimicVersion = "0.1.0"
val mimicVersionCode = mimicVersion.split('.').map { it.toInt() }.let { (ma, mi, pa) ->
    require(mi < 100 && pa < 100) { "MINOR and PATCH must be below 100" }
    ma * 10000 + mi * 100 + pa
}

// Release signing comes from keystore.properties at the repo root (git-ignored) or from env vars
// MIMIC_KEYSTORE, MIMIC_KEYSTORE_PASSWORD, MIMIC_KEY_ALIAS, MIMIC_KEY_PASSWORD. With neither, the
// release build is signed with the debug key so it still builds, and is NOT fit to publish.
val signingProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
fun signingValue(prop: String, env: String): String? =
    signingProps.getProperty(prop)?.takeIf { it.isNotBlank() } ?: System.getenv(env)?.takeIf { it.isNotBlank() }
val releaseStore = signingValue("storeFile", "MIMIC_KEYSTORE")
val hasReleaseKey = releaseStore != null

android {
    namespace = "dev.mimic"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.mimic"
        minSdk = 29
        targetSdk = 35
        versionCode = mimicVersionCode
        versionName = mimicVersion
    }

    signingConfigs {
        if (hasReleaseKey) create("release") {
            storeFile = rootProject.file(releaseStore!!)
            storePassword = signingValue("storePassword", "MIMIC_KEYSTORE_PASSWORD")
            keyAlias = signingValue("keyAlias", "MIMIC_KEY_ALIAS")
            keyPassword = signingValue("keyPassword", "MIMIC_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            // Only release builds look for updates: a debug-signed install cannot take a release APK.
            buildConfigField("boolean", "UPDATE_CHECK", "true")
        }
        debug {
            buildConfigField("boolean", "UPDATE_CHECK", "false")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

// Name release APKs mimic-<version>.apk (debug stays app-debug.apk for the existing adb scripts).
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.outputs.forEach { out ->
            (out as? com.android.build.api.variant.impl.VariantOutputImpl)?.outputFileName?.set("mimic-$mimicVersion.apk")
        }
    }
}

gradle.taskGraph.whenReady {
    if (!hasReleaseKey && allTasks.any { it.name.startsWith("assembleRelease") || it.name.startsWith("bundleRelease") }) {
        logger.warn("Mimic: keystore.properties not found; release APK is DEBUG-SIGNED. Do not publish it.")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    testImplementation("junit:junit:4.13.2")
}
