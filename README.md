# FilePilot

Secure and user-friendly file browser built with Python and Flask.

## Features

- List directories and browse files
- Display file size and last modified date
- Inline preview of images and PDFs
- Password-protected access (via `FILEPILOT_PASSWORD` env var)
- Multi-language support (English / Arabic)
- File-type icons for easier identification
- Breadcrumb navigation with search persistence
- Directory ZIP download

## Requirements

- Python 3.8+
- Flask

## Installation & Usage

```bash
git clone git@github.com:T3rmx/File-Pilot.git
cd File-Pilot
pip install -r requirements.txt

# Optional: password-protect the server
export FILEPILOT_PASSWORD="your-password"

# Optional: set a custom secret key (auto-generated if omitted)
export FILEPILOT_SECRET="your-secret-key"

python app.py
```

Open `http://localhost:8000` in your browser.

## Configuration

| Environment Variable | Description |
|---|---|
| `FILEPILOT_PASSWORD` | Set to enable password-protected access |
| `FILEPILOT_SECRET` | Flask session secret key (auto-generated if not set) |

## TODO

- File upload support
- File operations (copy/delete)
- UI enhancement using React or Bootstrap
- OAuth2 or Telegram login integration
