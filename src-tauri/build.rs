fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/64x64.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.ico");

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=helper/build-helpers.sh");
        println!("cargo:rerun-if-changed=helper/keepawake-helper.swift");
        println!("cargo:rerun-if-changed=helper/keepawake-registrar.swift");
        println!("cargo:rerun-if-changed=helper/com.panes.app.helper.keepawake.plist");
        // The bundler picks the compiled helpers up out of helper/build (see
        // externalBin in tauri.macos.conf.json). Listing the outputs makes
        // cargo re-run this script when they are missing, which is what happens
        // on CI where target/ is restored from cache but helper/build is not.
        println!("cargo:rerun-if-changed=helper/build/PanesHelperRegistrar-universal-apple-darwin");
        println!(
            "cargo:rerun-if-changed=helper/build/com.panes.app.helper.keepawake-universal-apple-darwin"
        );
        compile_macos_helpers();
    }

    tauri_build::build()
}

/// Names of the universal binaries produced by `helper/build-helpers.sh`.
#[cfg(target_os = "macos")]
const HELPER_BINARIES: [&str; 2] = ["PanesHelperRegistrar", "com.panes.app.helper.keepawake"];

#[cfg(target_os = "macos")]
const HELPER_TRIPLES: [&str; 3] = [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "universal-apple-darwin",
];

#[cfg(target_os = "macos")]
fn modified(path: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

/// Whether every helper artifact exists and is newer than the Swift sources
/// and the build script. Rebuilding on every cargo invocation would rewrite
/// files under `src-tauri/helper/build`, and `tauri dev` restarts the build
/// each time something under `src-tauri` changes.
#[cfg(target_os = "macos")]
fn helpers_up_to_date(helper_dir: &std::path::Path, output_dir: &std::path::Path) -> bool {
    let sources = [
        helper_dir.join("build-helpers.sh"),
        helper_dir.join("keepawake-helper.swift"),
        helper_dir.join("keepawake-registrar.swift"),
    ];
    let Some(newest_source) = sources.iter().map(|path| modified(path)).max().flatten() else {
        return false;
    };
    HELPER_BINARIES.iter().all(|name| {
        std::iter::once(output_dir.join(name))
            .chain(
                HELPER_TRIPLES
                    .iter()
                    .map(|triple| output_dir.join(format!("{name}-{triple}"))),
            )
            .all(|path| modified(&path).is_some_and(|stamp| stamp >= newest_source))
    })
}

#[cfg(target_os = "macos")]
fn compile_macos_helpers() {
    let helper_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("helper");
    let build_script = helper_dir.join("build-helpers.sh");
    // Always build into helper/build. It is the one path that does not move
    // with the cargo profile or target triple, so tauri.conf.json can point at
    // it from a static config.
    let output_dir = helper_dir.join("build");

    if !build_script.exists() {
        println!(
            "cargo:warning=Helper build script not found at {}, skipping helper compilation. The packaged app will not contain the keep-awake helper.",
            build_script.display()
        );
        return;
    }

    if !helpers_up_to_date(&helper_dir, &output_dir) {
        let status = std::process::Command::new("bash")
            .arg(&build_script)
            .arg(&output_dir)
            .status();

        match status {
            Ok(exit) if exit.success() => {}
            Ok(exit) => {
                println!(
                    "cargo:warning=Helper build script exited with status {exit}, the packaged app will not contain the keep-awake helper"
                );
                return;
            }
            Err(error) => {
                println!(
                    "cargo:warning=Failed to run helper build script: {error}, the packaged app will not contain the keep-awake helper"
                );
                return;
            }
        }
    }

    // Mirror the binaries next to the cargo executable so `cargo run` and
    // `tauri dev` resolve the registrar as a sibling of the main binary, the
    // same way they resolve it inside a packaged app bundle. Only copy when
    // the mirror is missing or older than the artifact.
    if let Some(profile_dir) = cargo_profile_dir() {
        for name in HELPER_BINARIES {
            let source = output_dir.join(name);
            let destination = profile_dir.join(name);
            if source == destination {
                continue;
            }
            let stale = match (modified(&source), modified(&destination)) {
                (Some(src), Some(dst)) => src > dst,
                (Some(_), None) => true,
                (None, _) => false,
            };
            if !stale {
                continue;
            }
            if let Err(error) = std::fs::copy(&source, &destination) {
                println!(
                    "cargo:warning=Failed to copy {name} to {}: {error}",
                    destination.display()
                );
            }
        }
    }
}

/// `target/<triple?>/<profile>`, the directory that holds the cargo binary.
#[cfg(target_os = "macos")]
fn cargo_profile_dir() -> Option<std::path::PathBuf> {
    let out_dir = std::env::var_os("OUT_DIR")?;
    let out_dir = std::path::PathBuf::from(out_dir);

    // OUT_DIR is <profile>/build/<pkg>-<hash>/out
    out_dir.ancestors().nth(3).map(std::path::Path::to_path_buf)
}
