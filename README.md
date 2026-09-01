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
Why?
Avoids JSON serialization and parsing in the file-data hot path
Provides predictable frame boundaries over a TCP byte stream
Allows file offsets to be represented using 64-bit unsigned integers
Keeps control messages and bulk file data separated
Reduces unnecessary string processing while transferring large files

File offsets are encoded using BigUInt64BE, allowing the protocol to represent files well beyond traditional 32-bit size limitations.

2. Buffer Pooling and Memory Management

Large file transfers can generate a significant number of temporary buffer allocations.

Lightning Share uses an explicit BufferPool to reuse buffers during network transfers rather than allocating a new buffer for every chunk.

This helps:

Reduce allocation pressure
Reduce unnecessary garbage collection
Keep memory usage more predictable
Improve consistency during long-running transfers

The goal is to keep the transfer pipeline focused on moving data rather than constantly allocating and releasing memory.

3. mDNS Peer Discovery

Lightning Share uses Multicast DNS (mDNS) for zero-configuration peer discovery on the local network.

Each running instance can advertise itself and discover other available Lightning Share instances without requiring a central discovery server.

Device A
   |
   | mDNS
   |
Local Network
   |
   | mDNS
   |
Device B

This means users do not need to manually enter IP addresses or configure a cloud-based signaling service just to find another device on the same network.

4. TLS Encryption and File Integrity

Network communication is protected using TLS with locally generated certificates.

The encrypted connection provides:

Confidentiality for transferred data
Protection against modification of data while in transit
Encrypted control and transfer traffic

For post-transfer verification, Lightning Share uses BLAKE3 hashing to calculate and compare file integrity information.

Sender
  |
  | File
  v
BLAKE3 Hash
  |
  | Transfer
  v
Receiver
  |
  v
BLAKE3 Hash
  |
  +── Compare ──> Valid / Invalid

This allows the receiver to verify that the resulting file matches the original transfer payload.

5. Decoupled Control Plane and Real-Time Telemetry

The networking layer and frontend are separated into different responsibilities.

              Lightning Share
                     |
        +------------+------------+
        |                         |
   Network Core              React Frontend
   Node.js / TCP              React / Vite
   TLS / mDNS                 Zustand
   File Transfer              WebSockets
        |                         |
        +---------- WebSocket ----+
                     |
              Real-Time State

The Node.js networking layer handles peer discovery, connections, transfer sessions, and file operations.

The React frontend consumes real-time state through WebSockets and displays:

Connected peers
Transfer progress
Current transfer speeds
Network status
Session information
Transfer history

Zustand is used to manage frontend state and keep frequently changing transfer data isolated from unrelated UI components.

Transfer Flow

A simplified transfer looks like this:

1. Peer Discovery
        ↓
2. Connection Establishment
        ↓
3. TLS Handshake
        ↓
4. Session Handshake
        ↓
5. File Metadata Exchange
        ↓
6. Chunked Binary Transfer
        ↓
7. Progress / Telemetry Updates
        ↓
8. Transfer Completion
        ↓
9. BLAKE3 Integrity Verification

For interrupted transfers, the session can use the last known offset to continue from the previously transferred position instead of starting from zero.

Key Capabilities
Direct Subnet Transfers

Files are transferred directly between devices connected to the same local network.

No cloud storage or external file-hosting service is required for the transfer itself.

Directory Transfer

Folders can be transferred recursively while preserving their relative directory structure.

Example:

Documents/
├── Notes/
│   ├── notes.txt
│   └── ideas.md
├── Projects/
│   └── project.zip
└── image.png

The receiver reconstructs the corresponding directory hierarchy.

Resumable Transfers

Transfers maintain session and offset information so an interrupted transfer can continue from the last successfully transferred position.

This is particularly useful for large files where restarting the entire transfer would be expensive.

Real-Time Telemetry

Transfer information is exposed to the frontend through WebSockets.

The dashboard can display:

Transfer progress
Current transfer speed
Connection state
Peer discovery state
Network metrics
Transfer history
Tech Stack
Frontend
React
TypeScript
Vite
Zustand
Backend / Networking
Node.js
TypeScript
TCP sockets
TLS
WebSockets
mDNS
Security / Integrity
TLS
Self-signed X.509 certificates
BLAKE3
Tooling
npm
ESLint
TypeScript
Project Structure
Lightning-Share/
├── src/
│   ├── renderer/       # React frontend
│   ├── server/         # Node.js networking layer
│   ├── shared/         # Shared types / protocol definitions
│   └── ...
├── public/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json
└── README.md

The exact structure may evolve as the project develops.

Installation
Prerequisites
Node.js 18 or higher
npm 9 or higher
Clone the Repository
git clone https://github.com/akaashvermaa/Lightning-Share.git
cd Lightning-Share
Install Dependencies
npm install
Development

Start the frontend and networking server in development mode:

npm run dev

This runs the development environment with hot reloading.

Production Build

Build the frontend and server:

npm run build

Then start the production server:

npm start
Available Scripts
Command	Description
npm run dev	Start the development environment
npm run build	Build frontend and server
npm start	Start the production server
npm run lint	Run ESLint
npm run typecheck	Run the TypeScript compiler without emitting files
Deployment

The web client includes Vercel configuration for deploying the frontend.

Vercel
Import the repository into Vercel.
Select Vite as the framework preset.
Use the frontend build command configured for the project.
Set the output directory to:
dist/renderer
Deploy.
Important

The Vercel deployment is intended for the web interface.

The local networking functionality depends on the Node.js server, TCP sockets, mDNS, and the local network environment, so it is not equivalent to deploying the entire transfer engine as a serverless application.

Design Goals

Lightning Share was built around a few simple principles:

Local First

Keep file transfers within the local network whenever possible.

Minimal Dependencies

Use existing networking primitives rather than building the system around a cloud service.

Reliable Transfers

Large files should not have to restart from the beginning just because a connection temporarily fails.

Observable Networking

The frontend should provide useful visibility into what the networking layer is actually doing.

Simple User Experience

The underlying networking can be complex while the actual user experience remains straightforward.

Current Limitations

Lightning Share is primarily designed for devices that can communicate over the same local network.

Depending on the network environment, peer discovery and direct connectivity may be affected by:

Client isolation on Wi-Fi networks
Firewall rules
Router multicast configuration
Operating-system network permissions
Corporate or restricted networks

These are properties of the underlying local network rather than the file-transfer UI itself.

Future Improvements

Potential areas for further development include:

Improved transfer queue management
More detailed transfer diagnostics
Better handling of network interruptions
Parallel transfer optimization
Additional platform support
Improved peer authentication
More extensive performance benchmarking
License

Distributed under the MIT License.
