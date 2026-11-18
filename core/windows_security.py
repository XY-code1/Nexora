"""Native filesystem permission helpers for local sensitive data."""

from __future__ import annotations

import ctypes
import os
import threading
from ctypes import wintypes
from pathlib import Path

_REPAIRED_TREES: set[Path] = set()
_REPAIR_LOCK = threading.Lock()


def _windows_error(action: str) -> RuntimeError:
    code = ctypes.get_last_error()
    return RuntimeError(f"{action}失败：WinError {code} ({ctypes.FormatError(code).strip()})")


def _current_user_sid() -> str:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPWSTR)]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise _windows_error("读取当前 Windows token")
    try:
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        if ctypes.get_last_error() != 122 or not size.value:
            raise _windows_error("读取当前 Windows SID 大小")
        buffer = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, 1, buffer, size, ctypes.byref(size)):
            raise _windows_error("读取当前 Windows SID")

        class SidAndAttributes(ctypes.Structure):
            _fields_ = [("sid", wintypes.LPVOID), ("attributes", wintypes.DWORD)]

        user = ctypes.cast(buffer, ctypes.POINTER(SidAndAttributes)).contents
        text = wintypes.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(user.sid, ctypes.byref(text)):
            raise _windows_error("格式化当前 Windows SID")
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.CloseHandle(token)


def _set_windows_acl(path: Path, *, directory: bool) -> None:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.DWORD)
    ]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    advapi32.SetFileSecurityW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPVOID]
    advapi32.SetFileSecurityW.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    inheritance = "OICI" if directory else ""
    current_sid = _current_user_sid()
    sddl = (
        f"O:{current_sid}D:P(A;{inheritance};FA;;;{current_sid})"
        f"(A;{inheritance};FA;;;SY)(A;{inheritance};FA;;;BA)"
    )
    descriptor = wintypes.LPVOID()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl, 1, ctypes.byref(descriptor), None
    ):
        raise _windows_error("创建私有 Windows DACL")
    try:
        # The full protected DACL is applied atomically; there is no temporary
        # inheritance-removal state that can lock out the current user.
        if not advapi32.SetFileSecurityW(str(path), 0x80000005, descriptor):
            raise _windows_error(f"保护敏感路径 {path}")
    finally:
        kernel32.LocalFree(descriptor)


def protect_private_path(path: Path, *, directory: bool = False) -> Path:
    """Allow only the current user, SYSTEM and Administrators full control."""
    target = path.expanduser().resolve()
    if os.name == "nt":
        _set_windows_acl(target, directory=directory)
    else:
        os.chmod(target, 0o700 if directory else 0o600)
    return target


def ensure_private_directory(path: Path) -> Path:
    target = path.expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    return protect_private_path(target, directory=True)


def _repair_private_tree(target: Path) -> None:
    """Repair an app-owned tree without following links or junctions."""
    protect_private_path(target, directory=True)
    with os.scandir(target) as entries:
        for entry in entries:
            child = Path(entry.path)
            if entry.is_symlink():
                raise RuntimeError(f"私有应用目录包含不受支持的链接：{child}")
            if entry.is_dir(follow_symlinks=False):
                _repair_private_tree(child)
            else:
                protect_private_path(child)


def ensure_private_tree(path: Path) -> Path:
    """Create and once-per-process repair an app-owned private hierarchy."""
    target = ensure_private_directory(path)
    with _REPAIR_LOCK:
        if target not in _REPAIRED_TREES:
            _repair_private_tree(target)
            _REPAIRED_TREES.add(target)
    return target
