#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

const PORT: u16 = 6969;
const APP_DIR: &str = "FilePilot";

static SHUTDOWN_REQUESTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn shutdown_requested() -> bool {
    SHUTDOWN_REQUESTED.load(std::sync::atomic::Ordering::Relaxed)
}

fn request_shutdown() {
    SHUTDOWN_REQUESTED.store(true, std::sync::atomic::Ordering::Relaxed);
}

struct Sidecar(Mutex<Option<Child>>);

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .data_dir()
        .map(|path| path.join(APP_DIR))
        .unwrap_or_else(|_| PathBuf::from("data"))
}

fn sidecar_path() -> PathBuf {
    let exe = std::env::current_exe().expect("FilePilot executable path");
    let dir = exe.parent().expect("FilePilot executable directory");
    let suffix = std::env::consts::EXE_SUFFIX;
    let plain = dir.join(format!("filepilot-backend{suffix}"));
    if plain.is_file() {
        return plain;
    }
    let triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-unknown-linux-gnu");
    dir.join(format!("filepilot-backend-{triple}{suffix}"))
}

fn port_open() -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn saved_scheme(dir: &Path) -> &'static str {
    let Ok(text) = fs::read_to_string(dir.join("runtime.json")) else {
        return "https";
    };
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if value.get("tls").and_then(Value::as_str) == Some("off") {
        "http"
    } else {
        "https"
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn fail(app: &AppHandle, message: &str) {
    let _ = app
        .dialog()
        .message(message)
        .title("FilePilot")
        .blocking_show();
    app.exit(1);
}

fn child_exited(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<Sidecar>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.as_mut() {
                return matches!(child.try_wait(), Ok(Some(_)));
            }
        }
    }
    false
}

fn spawn_sidecar(app: &AppHandle) -> Result<Child, String> {
    let dir = data_dir(app);
    let logs = dir.join("logs");
    fs::create_dir_all(&logs).map_err(|err| format!("Could not create {}: {err}", dir.display()))?;

    let path = sidecar_path();
    if !path.is_file() {
        return Err(format!(
            "The FilePilot server component is missing:\n\n{}",
            path.display()
        ));
    }

    let log_path = logs.join("desktop.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| format!("Could not open {}: {err}", log_path.display()))?;
    let log_err = log
        .try_clone()
        .map_err(|err| format!("Could not open the desktop log: {err}"))?;

    let mut command = Command::new(&path);
    command
        .env("FILEPILOT_DATA_DIR", &dir)
        .env("FILEPILOT_IMPORT_LEGACY", "false")
        .env("FILEPILOT_HOST", "0.0.0.0")
        .env("FILEPILOT_PORT", PORT.to_string())
        .env("FILEPILOT_DESKTOP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|err| format!("Could not start the FilePilot server:\n\n{err}"))
}

fn supervise(app: AppHandle) {
    let mut failure_count: u32 = 0;
    let mut navigated = false;
    let mut ready_since: Option<Instant> = None;
    let deadline = Instant::now() + Duration::from_secs(120);

    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(300));
            if shutdown_requested() {
                return;
            }

        if child_exited(&app) {
            let dir = data_dir(&app);
            let restart_pending = dir
                .join("restart.pending")
                .exists()
                || dir.join("reset.pending").exists();
            let _ = fs::remove_file(dir.join("restart.pending"));
            let _ = fs::remove_file(dir.join("reset.pending"));
            if restart_pending {
                failure_count = 0;
            }
            failure_count += 1;
            if failure_count > 5 {
                fail(
                    &app,
                    "The FilePilot server component keeps stopping.\n\nSee the desktop log in the FilePilot data folder for details.",
                );
                return;
            }
            let spawned = spawn_sidecar(&app).and_then(|child| {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(child);
                    }
                }
                Ok(())
            });
            if let Err(message) = spawned {
                fail(&app, &message);
                return;
            }
            navigated = false;
            ready_since = None;
        }

        if port_open() {
            let now = Instant::now();
            if ready_since.is_none() {
                ready_since = Some(now);
            }
            let settled = ready_since
                .map(|at| now.duration_since(at).as_millis() as u64 >= 1500)
                .unwrap_or(false);
            if settled && !navigated {
                navigated = true;
                let dir = data_dir(&app);
                let scheme = saved_scheme(&dir);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(format!(
                        "window.location.replace('{scheme}://127.0.0.1:{PORT}/')"
                    ));
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        } else {
            ready_since = None;
            if Instant::now() > deadline {
                fail(
                    &app,
                    "The FilePilot server did not start in time.\n\nPort 6969 may be in use. See the desktop log in the FilePilot data folder.",
                );
                return;
            }
        }
        }
    });
}

#[cfg(target_os = "linux")]
fn trust_local_certificate(window: &WebviewWindow) {
    use webkit2gtk::{WebContextExt, WebViewExt};
    let _ = window.with_webview(|webview| {
        if let Some(context) = webview.inner().context() {
            context.set_tls_errors_policy(webkit2gtk::TLSErrorsPolicy::Ignore);
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn trust_local_certificate(_window: &WebviewWindow) {}

#[cfg(unix)]
fn stop_child(child: &mut Child) {
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(400));
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn stop_child(child: &mut Child) {
    use std::os::windows::process::CommandExt;

    // PyInstaller's one-file bootloader owns the actual server process, so kill
    // the whole tree instead of leaving the backend bound to port 6969.
    let pid = child.id().to_string();
    let killed = Command::new("taskkill")
        .args(["/PID", pid.as_str(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !killed {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(not(any(unix, windows)))]
fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("FilePilot")
            .inner_size(1200.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .visible(false)
            .on_navigation(|url| {
                let scheme = url.scheme();
                let host = url.host_str().unwrap_or("");
                scheme == "tauri"
                    || ((scheme == "http" || scheme == "https")
                        && (host == "127.0.0.1" || host == "localhost"))
            });

            // WebView2 rejects the local self-signed certificate by default.
            #[cfg(windows)]
            let builder = builder.additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                 --ignore-certificate-errors",
            );

            let window = builder.build()?;

            trust_local_certificate(&window);

            // Check for updates on startup (desktop only)
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let updater = match handle.updater() {
                        Ok(updater) => updater,
                        Err(_) => return,
                    };
                    let Ok(Some(update)) = updater.check().await else {
                        return;
                    };
                    let restart_handle = handle.clone();
                    handle
                        .dialog()
                        .message(format!(
                            "FilePilot {} is available. Install it now?",
                            update.version
                        ))
                        .title("FilePilot Update")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Info)
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                            "Install".into(),
                            "Dismiss".into(),
                        ))
                        .show(move |install| {
                            if !install {
                                return;
                            }
                            tauri::async_runtime::spawn(async move {
                                if update
                                    .download_and_install(|_chunk, _total| {}, || {})
                                    .await
                                    .is_ok()
                                {
                                    restart_handle.restart();
                                }
                            });
                        });
                });
            }

            if port_open() {
                fail(
                    &handle,
                    "Port 6969 is already in use.\n\nClose the other program or the existing FilePilot server, then start FilePilot again.",
                );
                return Ok(());
            }

            match spawn_sidecar(&handle) {
                Ok(child) => {
                    handle.manage(Sidecar(Mutex::new(Some(child))));
                    thread::spawn(move || supervise(handle.clone()));
                }
                Err(message) => fail(&handle, &message),
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building FilePilot");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            request_shutdown();
            if let Some(state) = handle.try_state::<Sidecar>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        stop_child(&mut child);
                    }
                }
            }
        }
    });
}
