from __future__ import annotations

import datetime as dt
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .config import Settings


def _write_private_key(path: Path, key) -> None:
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _load_or_create_ca(settings: Settings):
    cert_path = settings.certs_dir / "ca.crt"
    key_path = settings.certs_dir / "ca.key"
    if cert_path.is_file() and key_path.is_file():
        return (
            x509.load_pem_x509_certificate(cert_path.read_bytes()),
            serialization.load_pem_private_key(key_path.read_bytes(), password=None),
        )

    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "FilePilot Local CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "FilePilot"),
        ]
    )
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    _write_private_key(key_path, key)
    return cert, key


def _san_names(hosts: list[str]) -> list[x509.GeneralName]:
    names: list[x509.GeneralName] = []
    for host in hosts:
        try:
            names.append(x509.IPAddress(ipaddress.ip_address(host)))
        except ValueError:
            names.append(x509.DNSName(host))
    return names


def _leaf_matches(path: Path, hosts: list[str]) -> bool:
    try:
        cert = x509.load_pem_x509_certificate(path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        names = set(san.get_values_for_type(x509.DNSName))
        names |= {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
        if not set(hosts).issubset(names):
            return False
        expires = cert.not_valid_after_utc
        return expires > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
    except Exception:
        return False


def ensure_certificates(settings: Settings, extra_hosts: list[str] | None = None) -> tuple[Path, Path]:
    """Generate (or reuse) a local CA and a leaf certificate covering this machine."""
    settings.certs_dir.mkdir(parents=True, exist_ok=True)
    hosts = ["localhost", "127.0.0.1", "::1", socket.gethostname(), *(extra_hosts or [])]
    hosts = list(dict.fromkeys(hosts))

    ca_cert, ca_key = _load_or_create_ca(settings)
    leaf_cert_path = settings.certs_dir / "server.crt"
    leaf_key_path = settings.certs_dir / "server.key"

    if _leaf_matches(leaf_cert_path, hosts) and leaf_key_path.is_file():
        return leaf_cert_path, leaf_key_path

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, "FilePilot"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "FilePilot"),
                ]
            )
        )
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=397))
        .add_extension(x509.SubjectAlternativeName(_san_names(hosts)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    leaf_cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    _write_private_key(leaf_key_path, key)
    return leaf_cert_path, leaf_key_path
