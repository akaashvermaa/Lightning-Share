# Lightning Share

A local-network file transfer tool for sharing files directly between devices without relying on removable storage or internet connectivity.

Lightning Share is built around direct TCP communication, automatic peer discovery, resumable transfers, encrypted transport, and real-time transfer telemetry.

`React` `TypeScript` `Node.js` `TCP` `TLS` `WebSockets` `mDNS` `BLAKE3`

---

## Features

- Direct file and folder transfers over the local network
- Automatic peer discovery using mDNS
- Custom binary protocol for file transfer frames
- TLS-encrypted communication
- Resumable transfers using transfer offsets
- Recursive folder transfer with directory structure preservation
- BLAKE3-based file integrity verification
- Real-time transfer progress and network telemetry
- React-based dashboard for monitoring connected peers and transfers
- No cloud storage or third-party file hosting required

---

## Technical Architecture

### 1. Custom Binary Framing Protocol over TCP/TLS

Instead of using HTTP multipart uploads for file data, Lightning Share uses a custom binary framing protocol directly over a TLS stream.

The protocol separates control messages from high-frequency file data:

```text
TCP/TLS Connection
        |
        +── Control Frames (0x00)
        |     ├── Handshake
        |     ├── Session Control
        |     ├── Pause / Resume
        |     └── Error Messages
        |
        +── Data Frames (0x01)
              └── File Chunks
