Task 12: README Security Warnings - Search Evidence
====================================================

Searched README.md for all required warning phrases on 2026-05-06.

Required phrase: "no built-in app auth"
Found at line 157: "**No built-in application authentication.** Anyone who can reach the web UI or gateway can open SSH sessions to arbitrary hosts."
Status: PRESENT

Required phrase: "localStorage"
Found at line 159: "**localStorage password storage is unsafe.** If you check "Remember password on this browser," the password is stored in browser localStorage."
Status: PRESENT

Required phrase: "auto-accept"
Found at line 161: "**Auto-accepted SSH host keys.** The gateway accepts any SSH host key without verification."
Status: PRESENT

Required phrase: "MITM" / "man-in-the-middle"
Found at line 161: "This means connections are vulnerable to man-in-the-middle attacks."
Status: PRESENT

Required phrase: "arbitrary targets"
Found at line 157: "...can open SSH sessions to arbitrary hosts."
Found at line 163: "**Arbitrary SSH targets.** The gateway will attempt to connect to any host and port the user enters."
Status: PRESENT

Required phrase: "do not expose publicly"
Found at line 165: "**Do not expose publicly without external protection.** This app is designed for localhost use or private networks."
Status: PRESENT

Required exclusions verified:
- SSH key auth: line 171 "SSH key authentication (password only)"
- SFTP/file transfer: line 172 "SFTP or file transfer"
- Port forwarding: line 173 "SSH port forwarding"
- Terminal recording: line 174 "Terminal recording or session replay"
- RBAC/user accounts: line 175 "User accounts, RBAC, or admin allowlists"
- Database persistence: line 176 "Database persistence (sessions are in-memory only)"

Summary: 6/6 required warning phrases PRESENT. 6/6 required exclusions PRESENT.
