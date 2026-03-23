#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match agent_workspace_lib::maybe_handle_cli_subcommand() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
    agent_workspace_lib::run();
}
