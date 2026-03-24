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
        compile_macos_helpers();
    }

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn compile_macos_helpers() {
    let helper_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("helper");
    let build_script = helper_dir.join("build-helpers.sh");
    let output_dir = helper_output_dir().unwrap_or_else(|| helper_dir.join("build"));

    if !build_script.exists() {
        println!(
            "cargo:warning=Helper build script not found at {}, skipping helper compilation",
            build_script.display()
        );
        return;
    }

    let status = std::process::Command::new("bash")
        .arg(&build_script)
        .arg(&output_dir)
        .status();

    match status {
        Ok(exit) if exit.success() => {}
        Ok(exit) => {
            println!(
                "cargo:warning=Helper build script exited with status {}, helpers may not be available",
                exit
            );
        }
        Err(error) => {
            println!(
                "cargo:warning=Failed to run helper build script: {error}, helpers may not be available"
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn helper_output_dir() -> Option<std::path::PathBuf> {
    let out_dir = std::env::var_os("OUT_DIR")?;
    let out_dir = std::path::PathBuf::from(out_dir);

    out_dir.ancestors().nth(3).map(std::path::Path::to_path_buf)
}
