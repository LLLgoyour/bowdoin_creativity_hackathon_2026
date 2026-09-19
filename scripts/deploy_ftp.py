"""Upload the static site to its dedicated FTP directory, without remote deletions."""

from __future__ import annotations

import os
from ftplib import FTP, error_perm
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


SITE = Path(__file__).resolve().parents[1] / "site"


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing {name}. Set it as a GitHub Actions secret.")
    return value


def enter_directory(ftp: FTP, directory: str) -> None:
    """Create and enter a directory relative to the current FTP directory."""
    for part in PurePosixPath(directory).parts:
        if part in {"", ".", "/"}:
            continue
        if part == "..":
            raise SystemExit("FTP_SERVER_DIR must not contain '..'.")
        try:
            ftp.cwd(part)
        except error_perm:
            ftp.mkd(part)
            ftp.cwd(part)


def main() -> None:
    server = required("FTP_SERVER")
    username = required("FTP_USERNAME")
    password = required("FTP_PASSWORD")
    remote_dir = required("FTP_SERVER_DIR")
    if remote_dir in {"/", ".", "./"} or ".." in PurePosixPath(remote_dir).parts:
        raise SystemExit("FTP_SERVER_DIR must name a dedicated subdomain directory.")

    endpoint = urlsplit(server if "://" in server else f"ftp://{server}")
    if (endpoint.scheme != "ftp" or not endpoint.hostname
            or endpoint.path not in {"", "/"} or endpoint.port not in {None, 21}):
        raise SystemExit("FTP_SERVER must be a hostname or IP address for FTP port 21.")

    ftp = FTP()
    ftp.connect(endpoint.hostname, 21, timeout=30)
    ftp.login(username, password)
    ftp.set_pasv(True)

    try:
        if remote_dir.startswith("/"):
            ftp.cwd("/")
        enter_directory(ftp, remote_dir)
        root = ftp.pwd()

        files = sorted(path for path in SITE.rglob("*") if path.is_file() and not path.is_symlink())
        if not files:
            raise SystemExit("site/ contains no files to upload.")
        for path in files:
            relative = path.relative_to(SITE)
            ftp.cwd(root)
            enter_directory(ftp, str(PurePosixPath(*relative.parts).parent))
            with path.open("rb") as source:
                ftp.storbinary(f"STOR {relative.name}", source)
            print(f"Uploaded {relative.as_posix()}")
        print(f"Uploaded {len(files)} files to the configured FTP directory.")
    finally:
        try:
            ftp.quit()
        except OSError:
            ftp.close()


if __name__ == "__main__":
    main()
