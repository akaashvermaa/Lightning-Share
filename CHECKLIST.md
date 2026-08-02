# ⚡ LightningShare Engineering Checklist

> **Design Principle: LightningShare is file-type agnostic.** 
> It does not "understand" file extensions; it transports verified byte streams while preserving metadata (name, timestamps, permissions where supported, and directory structure). Any file that the operating system can read should be transferable unless prevented by OS permissions or the file changing during transfer.

> Goal: Build the fastest, most reliable peer-to-peer file sharing application.
>
> Every item should be marked:
>
> - [x] Completed
> - [~] Partially Implemented
> - [ ] Not Started

---

# 1. Core Architecture

- [x] React Frontend
- [x] TypeScript
- [x] Peer Discovery Service
- [x] Transfer Service
- [x] Device Manager
- [x] Transfer History
- [x] Settings System

---

# 2. Discovery

- [x] UDP Broadcast Discovery
- [x] Auto Device Discovery
- [x] Device Online Detection
- [x] Device Offline Detection
- [x] Automatic Refresh
- [x] Manual Refresh Button
- [x] mDNS / Bonjour Support
- [x] IPv6 Support

---

# 3. Networking

- [x] TLS Transfer Server
- [x] WebSocket Communication
- [x] Network Status Indicator
- [x] Automatic Reconnect
- [x] Session Recovery
- [x] Resume after Restart

---

# 4. File Transfer

- [x] Single File
- [x] Multiple Files
- [x] Drag & Drop
- [x] Upload Progress
- [x] Download Progress
- [x] Transfer History
- [x] Incoming Transfer Requests
- [x] Folder Transfer
- [x] Recursive Streaming
- [x] Folder Synchronization

---

# 5. Performance

- [x] Large Chunk Support
- [x] Streaming Transfer
- [x] Reduced Logging
- [x] Adaptive Chunk Size
- [x] Sliding Window
- [x] Multiple Chunks In Flight
- [x] Dynamic Window Size
- [x] Read Ahead Queue
- [x] Write Buffer Queue
- [x] Raw Binary Protocol
- [x] Base64 Binary Transfer
- [x] Zero Copy Streaming
- [x] Socket Buffer Optimization
- [x] Adaptive Compression

---

# 6. Reliability

- [x] Retry Logic
- [x] Chunk Acknowledgements
- [x] Chunk Retransmission
- [x] Resume after Disconnect
- [x] Resume after Application Restart
- [x] Resume after System Restart
- [x] Transfer Database
- [x] Session Persistence
- [x] Persistent Queue

---

# 7. Integrity

- [x] BLAKE3 Hashing
- [x] Chunk Verification
- [x] Whole File Verification
- [x] Corruption Detection
- [x] Automatic Retry of Corrupted Chunks

---

# 8. Peer-to-Peer

## Every running application must always act as BOTH:

- [x] Discovery Server
- [x] Transfer Server
- [x] Transfer Client
- [x] Session Manager
- [x] Upload Manager
- [x] Download Manager

No dedicated Sender Mode.

No dedicated Receiver Mode.

Every device is a Peer.

---

# 9. User Experience

- [x] Responsive Layout
- [x] Mobile Navigation
- [x] Accessible Controls
- [x] Keyboard Navigation
- [x] Search Transfer History
- [x] Filter History
- [x] Clear Transfer History
- [x] Progress Indicators
- [x] Error Messages
- [x] Network Indicator
- [x] Live Speed Graph
- [x] Diagnostics Window

---

# 10. Diagnostics

- [x] Connection Diagnostics
- [x] Discovery Diagnostics
- [x] TLS Diagnostics
- [x] Network Statistics
- [x] CPU Usage
- [x] Memory Usage
- [x] Transfer Statistics
- [x] Export Debug Report

---

# 11. Error Handling

The application MUST NEVER display generic errors.

Instead show:

✓ Device Offline

✓ Connection Refused

✓ TLS Handshake Failed

✓ Permission Denied

✓ Disk Full

✓ Destination Not Writable

✓ File Locked

✓ Network Timeout

✓ Checksum Failed

✓ Session Expired

Every error should include:

- Reason
- Suggested Fix
- Retry Button

---

# 12. File Support

## LightningShare MUST support EVERY file type.

There must NEVER be:

❌ Unsupported File Type

❌ Extension Not Supported

❌ Cannot Transfer This File

The application transfers bytes.

Therefore it must support:

✓ exe

✓ msi

✓ iso

✓ zip

✓ rar

✓ 7z

✓ tar

✓ gz

✓ mp4

✓ mkv

✓ mov

✓ avi

✓ mp3

✓ flac

✓ wav

✓ jpg

✓ png

✓ webp

✓ gif

✓ psd

✓ ai

✓ blend

✓ obj

✓ fbx

✓ pdf

✓ docx

✓ xlsx

✓ pptx

✓ sqlite

✓ db

✓ apk

✓ ipa (as a file)

✓ dmg

✓ pkg

✓ app bundles (preserving structure)

✓ node_modules

✓ Unreal Projects

✓ Unity Projects

✓ Git Repositories

✓ Hidden Files

✓ Symbolic Links (policy defined)

✓ Empty Files

✓ Empty Folders

✓ Long File Names

✓ Unicode Names

✓ Emoji File Names

✓ Files > 1 TB (streaming)

LightningShare should treat files as raw bytes, not based on extension.

---

# 13. Stress Testing

- [ ] 1 GB
- [ ] 10 GB
- [ ] 50 GB
- [ ] 100 GB
- [ ] 500 GB

Folders

- [ ] 100 files
- [ ] 1,000 files
- [ ] 10,000 files
- [ ] 50,000 files

Mixed

- [ ] Code Project
- [ ] Node Modules
- [ ] Steam Game
- [ ] Unreal Project
- [ ] Unity Project

---

# 14. Performance Targets

Target:

Discovery

<2 sec

Connection

<500 ms

Transfer Start

<1 sec

Resume

<3 sec

Memory

<100 MB

CPU

<20%

Speed

90–95% of available network bandwidth

Data Corruption

0 Bytes

---

# 15. Release Checklist

Before every release verify:

- [ ] Every transfer completes.
- [ ] Every checksum matches.
- [ ] No memory leak.
- [ ] No crashes.
- [ ] Bidirectional transfers work.
- [ ] Multiple simultaneous transfers work.
- [ ] Resume works after interruption.
- [ ] Resume works after app restart.
- [ ] Works on Windows ↔ Windows.
- [ ] Works on Windows ↔ macOS.
- [ ] Works on macOS ↔ macOS.
- [ ] Works with large folders.
- [ ] Works with very small files.
- [ ] No unsupported file extensions.
- [ ] Clear error messages for all failure scenarios.

---

# 16. Future Roadmap

## Version 1.5 – Fast
- [x] **Static Tiered Chunk Sizes**: Statically adjust chunk size based on file size (<50MB, 50MB-1GB, >1GB).
- [x] **Parallel Small-File Engine**: Keep multiple files flowing simultaneously (up to 4 active small files) for a massive speedup on projects like Node.js, Unity, etc.
- [x] **Smart Scheduler**: Prioritize important files like `README`, `package.json`, `src`, `config` before others.
- [x] **Memory Pool + Buffer Reuse**: Reuse buffers instead of allocating new ones for every chunk to lower GC pressure and sustain higher throughput.
- [x] **Simple Auto Tuning**: System dynamically tunes window size based on ACKs without complex CPU/disk overhead.

## Version 2.0 – Professional
- [x] **Workspace Sync**: Sync workspaces by transferring only changed files instead of the entire folder.
- [x] **Smart Resume Engine**: Store Transfer ID, Chunk Bitmap, Current Window, Hash State, and Pending Queue to seamlessly resume transfers across app crashes, restarts, or disconnects.
- [x] **Protocol V3**: Separate protocol into a Control Channel (JSON for ACK, Resume, Errors, Manifest) and a Data Channel (Raw Binary Only).
- [x] **Built-in Benchmark Engine**: One-click benchmark to measure read/write speed, network throughput, RTT, CPU, and RAM to automatically recommend settings.
- [x] **Smart Network Selection**: Automatically pick the fastest path (Wi-Fi, Ethernet, VPN) and seamlessly fallback if a network drops.
- [x] **Deep Diagnostics**: Expose RTT, Packet Loss, Window Size, Chunks In Flight, Disk Speed, CPU, Compression Ratio, and identify the current bottleneck (e.g., Receiver HDD, Weak Wi-Fi).
