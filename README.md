# **[Lightning Share](https://github.com/akaashvermaa/Lightning-Share)**

A local-network file transfer tool for sharing files directly between devices without relying on removable storage or internet connectivity. Built around reliable TCP-based communication.

`React` `TypeScript` `Node.js` `TCP` `Networking`

---

## Technical Architecture and System Design Decisions

### 1. Custom Binary Framing Protocol over TCP/TLS
- **Decision:** Rather than streaming files over standard HTTP multipart uploads or serializing frame metadata in JSON, LightningShare implements a low-overhead custom binary framing protocol directly over TLS streams.
- **Rationale:**
  - **Zero JSON Overhead in Hot Path:** High-speed streaming requires processing thousands of chunks per second. Serializing and parsing JSON objects inside the packet loop introduces heavy CPU overhead and V8 string garbage collection churn. The custom frame layout uses a 94-byte fixed binary header containing 32-bit/64-bit integer fields and zero-padded ASCII UUID buffers, allowing zero-copy memory reads without string parsing.
  - **Large File Support (up to 16 Exabytes):** Offsets are serialized using 64-bit Big-Endian unsigned integers (`BigUInt64BE`), supporting high-capacity storage drives without 32-bit (4 GB) overflow boundaries.
  - **Protocol Frame Isolation:** Control signals (handshakes, session pause/resume, error reporting) use readable JSON control frames (`0x00`), while high-frequency file data uses binary chunk frames (`0x01`).

### 2. Zero-Copy Buffer Pooling & Memory Management
- **Decision:** Implementation of an explicit `BufferPool` manager for stream chunk allocation.
- **Rationale:**
  - Standard `Buffer.alloc()` allocations inside high-frequency network socket loops trigger aggressive V8 Garbage Collection (GC) pauses when transferring multi-gigabyte files. These GC pauses introduce latency micro-stutters and throughput drop-offs.
  - Reusing pre-allocated memory buffers stabilizes throughput rates, reduces V8 heap allocation pressure, and guarantees continuous wire saturation.

### 3. Multicast DNS (mDNS) Zero-Configuration Discovery
- **Decision:** Peer discovery is powered by local UDP Multicast DNS (`multicast-dns`) broadcasting rather than central signaling servers or manual IP configuration.
- **Rationale:**
  - **Subnet Privacy:** File transfers remain strictly contained within the local physical or wireless network segment.
  - **Zero Setup:** Local instances automatically publish and discover active peers without cloud authentication, external internet access, or port forwarding configuration.

### 4. Ephemeral TLS Encryption & Cryptographic Integrity
- **Decision:** On-the-fly ephemeral X.509 certificate generation (`selfsigned`) paired with multi-threaded BLAKE3 cryptographic hashing (`blake3`).
- **Rationale:**
  - **Transport Encryption:** Local Wi-Fi networks are vulnerable to packet interception. Wrapping TCP streams in TLS guarantees payload confidentiality and prevents packet injection without requiring public domain CA infrastructure.
  - **Zero-Cost Integrity:** TLS guarantees stream framing integrity at the socket level. For post-transfer file validation, BLAKE3 delivers verification speeds exceeding 2 GB/s, outperforming legacy SHA-256 and MD5 implementations.

### 5. Decoupled Control Plane & Real-Time Telemetry
- **Decision:** Decoupled engine architecture pairing a Node.js network core with a React 18, Vite, and Zustand frontend connected over WebSockets.
- **Rationale:**
  - **State Decoupling:** Active peer tables, transfer progress state, and network metrics are managed via Zustand stores to prevent UI re-render bottlenecks during high-frequency telemetry updates.
  - **Real-Time Control:** WebSockets provide low-latency bidirectional communication for real-time throughput monitoring, speed graphing, and pause/resume coordination.

---

## Key Capabilities

- **Direct Subnet Transfers:** High-speed peer-to-peer file and folder transmission across local networks.
- **Directory Hierarchy Preservation:** Recursive directory tree parsing and relative path reconstruction upon receipt.
- **Resumable Transfers:** Offset tracking and session handshakes allow interrupted transfers to resume without re-sending completed chunks.
- **Live Network Telemetry:** Real-time visualization of network socket status, buffer window sizes, throughput metrics, and peer discovery health.

---

## Installation & Getting Started

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)

### Installation
```bash
# Clone the repository
git clone https://github.com/akaashvermaa/share.git
cd share

# Install dependencies
npm install
```

### Development Mode
Runs the TypeScript server and Vite frontend concurrently with hot-reloading:
```bash
npm run dev
```

### Production Build & Launch
Build client assets and server source code:
```bash
# Compile frontend and server assets
npm run build

# Start production server
npm start
```

---

## Scripts Reference

- `npm run dev`: Launch development server and Vite frontend concurrently
- `npm run build`: Compile client assets with Vite and server files with TypeScript
- `npm start`: Execute compiled production server
- `npm run lint`: Execute ESLint checks across TypeScript files
- `npm run typecheck`: Run TypeScript compiler check without emitting files

---

## License

Distributed under the MIT License.
