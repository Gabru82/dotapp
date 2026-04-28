require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3081;
const JWT_SECRET = process.env.JWT_SECRET;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "10mb" }));
const activeCalls = new Map();
// Configure Multer for media uploads
const uploadDir = UPLOAD_DIR;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Modified fileFilter
    const uploadType = req.query.uploadType; // Get upload type from query parameter

    if (uploadType === "document") {
      // Allow all file types for documents
      cb(null, true);
    } else if (uploadType === "media") {
      // Allow images, videos, and audio for media
      if (
        file.mimetype.startsWith("image/") ||
        file.mimetype.startsWith("video/") ||
        file.mimetype.startsWith("audio/") ||
        file.mimetype === "application/octet-stream" // Support for formats like HEIC/HEIF often misidentified
      ) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `Only images, videos, and audio are allowed for media uploads (received: ${file.mimetype})`,
          ),
        );
      }
    } else {
      // Default or fallback filter (e.g., only images/videos if no type specified)
      if (
        file.mimetype.startsWith("image/") ||
        file.mimetype.startsWith("video/")
      )
        cb(null, true);
      else cb(new Error("Only images and videos are allowed by default"));
    }
  },
});

// Middleware to set a basic Content Security Policy
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.socket.io; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https: https://ui-avatars.com; connect-src 'self' http://localhost:3001 ws://localhost:3001 https://cdn.socket.io https://dotapp.demotele.online wss://dotapp.demotele.online; media-src 'self' data:;",
  );
  next();
});

// Serve static files (JS, CSS, images) from the 'admin' folder
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Serve static files from the 'chatapp' folder (cleaner than individual routes)
app.use("/chatapp", express.static(path.join(__dirname, "chatapp")));
// Serve chatapp files at the root level so relative paths in login.html work
app.use(express.static(path.join(__dirname, "chatapp")));
// Serve uploaded files
app.use("/uploads", express.static(uploadDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "chatapp", "login.html"));
});

let db;

// Socket.io Authentication Middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // This will give us id and role
    let userDetails;
    if (decoded.role === "admin") {
      const result = await db.query(
        `SELECT id, name, role FROM admins WHERE id = $1`,
        [decoded.id],
      );
      userDetails = result.rows[0];
    } else {
      const result = await db.query(
        `SELECT id, name, role, active FROM users WHERE id = $1`,
        [decoded.id],
      );
      userDetails = result.rows[0];
    }
    if (!userDetails)
      return next(new Error("Authentication error: User not found"));

    socket.user = userDetails; // Store full user info in the socket object
    next(); // Proceed with connection
  } catch (err) {
    next(new Error("Authentication error: Invalid token or user details"));
  }
});

// Map to store active user sockets (userId -> socketId)
const activeUserSockets = new Map();
io.on("connection", (socket) => {
  activeUserSockets.set(socket.user.id, socket.id);
  console.log(`User connected: ${socket.user.id} (${socket.user.role})`);

  /**
   * Join a specific group room
   */
  socket.on("join-group", (groupId) => {
    const roomName = `group_${groupId}`;
    socket.join(roomName);
    console.log(`User ${socket.user.id} joined room: ${roomName}`);
  });

  /**
   * Leave a specific group room
   */
  socket.on("leave-group", (groupId) => {
    const roomName = `group_${groupId}`;
    socket.leave(roomName);
  });

  /**
   * Handle Real-time Messages
   */
  socket.on("send-message", async (data) => {
    const { groupId, content, type, file_url } = data;
    const userId = socket.user.id;
    const msgType = type || "text";

    if ((!content && !file_url) || !groupId) return;

    try {
      console.log(`[Message] From: ${userId} To Group: ${groupId}`);

      // 1. Save message to Database
      const result = await db.query(
        "INSERT INTO messages (group_id, user_id, content, type, file_url) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [parseInt(groupId), userId, content || null, msgType, file_url || null],
      );

      // 2. Fetch sender details
      const userResult = await db.query(
        "SELECT name, role FROM users WHERE id = $1 UNION SELECT name, role FROM admins WHERE id = $1",
        [userId],
      );
      const sender = userResult.rows[0];

      const messageObject = {
        id: result.rows[0].id,
        group_id: groupId,
        user_id: userId,
        user_name: sender.name,
        user_role: sender.role,
        content: content,
        type: msgType,
        file_url: file_url,
        created_at: new Date(),
      };

      // 3. Broadcast to everyone in the room
      io.to(`group_${groupId}`).emit("new-message", messageObject);
    } catch (err) {
      console.error("Error saving/sending message:", err);
      socket.emit("error-msg", "Failed to send message");
    }
  });

  // WebRTC Signal Relay
  socket.on("webrtc-signal", (data) => {
    const { to, signal, groupId } = data;
    const senderId = socket.user.id;

    // Find the recipient's active socket ID
    const recipientSocketId = activeUserSockets.get(to);

    if (recipientSocketId) {
      // Relay the signal to the target user
      io.to(recipientSocketId).emit("webrtc-signal", {
        from: senderId, // The sender of this signal
        signal: signal,
        groupId: groupId,
      });
    } else {
      console.warn(`Attempted to send WebRTC signal to offline user: ${to}`);
      socket.emit("call-error", `User ${to} is offline or not found.`);
    }
  });
  // WebRTC Call Signaling
  socket.on("start-call", async (data) => {
    const { type, groupId, targetUserId, fromName } = data;
    const callerId = socket.user.id;

    // Prevent user from starting a new call if already in one
    const isInCall = Array.from(activeCalls.values()).some((call) =>
      call.participants.has(callerId),
    );
    if (isInCall) {
      return socket.emit("call-error", "You are already in another call.");
    }

    // 1. Generate a unique call ID early so it can be used for tracking
    const callId = `${groupId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Save to DB
    const res = await db.query(
      "INSERT INTO calls (group_id, caller_id, type) VALUES ($1, $2, $3) RETURNING id",
      [parseInt(groupId), callerId, type],
    );
    const dbCallId = res.rows[0].id;
    await db.query(
      "INSERT INTO call_participants (call_id, user_id) VALUES ($1, $2)",
      [dbCallId, callerId],
    );

    activeCalls.set(callId, {
      callId,
      dbCallId,
      groupId,
      type,
      callerId,
      participants: new Set([callerId]),
    });
    try {
      // 2. Validate group and call features
      const groupResult = await db.query(
        "SELECT group_call_enabled, personal_call_enabled FROM groups WHERE id = $1",
        [parseInt(groupId)],
      );
      if (groupResult.rows.length === 0) {
        return socket.emit("call-error", "Group not found.");
      }

      const callSession = activeCalls.get(callId);
      const group = groupResult.rows[0];

      if (type === "group") {
        if (!group.group_call_enabled) {
          return socket.emit(
            "call-error",
            "Group calls are not enabled for this group.",
          );
        }
        const memberResult = await db.query(
          `SELECT user_id FROM group_members WHERE group_id = $1`,
          [parseInt(groupId)],
        );
        const adminResult = await db.query(
          `SELECT id FROM users WHERE role = 'admin'`,
        );

        if (callSession) callSession.participants = new Set([callerId]);

        const allGroupMembers = memberResult.rows.map((row) => row.user_id);
        const allAdmins = adminResult.rows.map((row) => row.id);
        const notifyIds = new Set([...allGroupMembers, ...allAdmins]);
        notifyIds.delete(callerId); // Do not notify the caller

        if (callSession) callSession.notifiedIds = Array.from(notifyIds);

        // Notify all other active members
        for (const participantId of notifyIds) {
          if (participantId !== callerId) {
            const participantSocketId = activeUserSockets.get(participantId);
            if (participantSocketId) {
              io.to(participantSocketId).emit("incoming-call", {
                callId,
                type: "group",
                groupId,
                callerId,
                fromName: socket.user.name,
                participants: Array.from(activeCalls.get(callId).participants), // Send current participants
              });
            }
          }
        }
        // Also send call-accepted to the caller immediately for group calls
        socket.emit("call-accepted", {
          callId, // The caller is already in the call
          type: "group",
          groupId,
          callerId,
          fromName,
          participants: [callerId],
        });
      } else if (type === "private") {
        if (!group.personal_call_enabled) {
          return socket.emit(
            "call-error",
            "Personal calls are not enabled for this group.",
          );
        }
        if (!targetUserId) {
          return socket.emit(
            "call-error",
            "Target user ID is required for personal calls.",
          );
        }

        // Check if target user exists and determine if they can be called in this group context
        const targetCheck = await db.query(
          `SELECT role, id FROM users WHERE id = $1`,
          [targetUserId],
        );
        if (targetCheck.rows.length === 0)
          return socket.emit("call-error", "User not found.");

        const membershipResult = await db.query(
          `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 
           UNION 
           SELECT 1 FROM groups WHERE id = $1 AND created_by = $2`,
          [parseInt(groupId), targetUserId],
        );

        // Allow call if target is in group, is the creator, or is an admin
        if (membershipResult.rows.length === 0 && targetCheck.rows[0].role !== "admin") {
          return socket.emit(
            "call-error",
            "Target user is not a member of this group.",
          );
        }

        const targetSocketId = activeUserSockets.get(targetUserId);
        if (targetSocketId) {
          if (callSession) {
            callSession.targetUserId = targetUserId;
            callSession.notifiedIds = [targetUserId];
          }
          io.to(targetSocketId).emit("incoming-call", {
            callId, // The target user needs the callId to accept
            type: "private",
            groupId,
            callerId,
            callerName: socket.user.name, // Send caller's name for display
            fromName,
            targetUserId,
            participants: [callerId, targetUserId], // For private calls, participants are just caller and target
          });

          // Notify the caller that the call session is ready so they can cancel/end it if needed
          socket.emit("call-accepted", {
            callId,
            type: "private",
            groupId,
            callerId,
            participants: [callerId],
          });

          // Set a timeout for the caller to know if the call was missed
          const missedTimeout = setTimeout(async () => {
            if (!activeCalls.has(callId)) return;

            const callerSocketId = activeUserSockets.get(callerId);
            if (callerSocketId) {
              io.to(callerSocketId).emit("call-missed", { callId });
            }

            // Update DB for call ending as missed
            await db.query(
              "UPDATE calls SET end_time = CURRENT_TIMESTAMP WHERE id = $1",
              [dbCallId],
            );

            activeCalls.delete(callId);
          }, 30000);

          if (callSession) callSession.timeout = missedTimeout;
        } else {
          socket.emit("call-error", "Target user is offline.");
          await db.query(
            "UPDATE calls SET end_time = CURRENT_TIMESTAMP WHERE id = $1",
            [dbCallId],
          );
          activeCalls.delete(callId);
        }
      }
    } catch (err) {
      console.error("Error starting call:", err);
      socket.emit("call-error", "Failed to start call.");
    }
  });

  socket.on("accept-call", async (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);
    const acceptorId = socket.user.id;

    if (!call) return;

    // Clear missed call timeout since the call was answered
    if (call.timeout) {
      clearTimeout(call.timeout);
      delete call.timeout;
    }

    // Prevent user from joining a call if already in another one
    const isInAnotherCall = Array.from(activeCalls.values()).some(
      (c) => c.callId !== callId && c.participants.has(acceptorId),
    );
    if (isInAnotherCall) {
      return socket.emit("call-error", "You are already in another call.");
    }

    // Add the acceptor to the call's participants
    call.participants.add(acceptorId);

    // Save participant to DB
    await db.query(
      "INSERT INTO call_participants (call_id, user_id) VALUES ($1, $2)",
      [call.dbCallId, acceptorId],
    );

    // Remove from notified list as they are now an active participant
    if (call.notifiedIds) {
      call.notifiedIds = call.notifiedIds.filter((id) => id !== acceptorId);
    }

    // Notify ALL current participants (including the new one) about the updated participant list
    // This is crucial for full mesh to establish connections with the new participant
    const updatedParticipants = Array.from(call.participants);
    updatedParticipants.forEach((participantId) => {
      const participantSocketId = activeUserSockets.get(participantId);
      if (participantSocketId) {
        io.to(participantSocketId).emit("call-accepted", {
          callId: callId,
          type: call.type,
          groupId: call.groupId,
          callerId: call.callerId,
          participants: updatedParticipants, // Send the full, updated list
        });
      }
    });
  });

  socket.on("reject-call", (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);
    if (!call) return;

    // Remove from notified list
    if (call.notifiedIds) {
      call.notifiedIds = call.notifiedIds.filter((id) => id !== socket.user.id);
    }

    const callerSocketId = activeUserSockets.get(call.callerId);
    if (callerSocketId) {
      io.to(callerSocketId).emit("call-rejected", {
        callId,
        fromName: socket.user.name,
      });
    }

    // Check if the call should end (e.g. no more pending and only 1 participant left)
    handleUserLeavingCall(null, callId);
  });
  socket.on("end-call", (data) => {
    const { callId } = data;
    handleUserLeavingCall(socket.user.id, callId);
  });

  async function handleUserLeavingCall(userId, callId) {
    const call = activeCalls.get(callId);
    if (!call) return;

    // 1. Remove the user from the participants list if they were in it
    if (userId && call.participants.has(userId)) {
      call.participants.delete(userId);

      // Update DB for participant leaving
      await db.query(
        "UPDATE call_participants SET left_at = CURRENT_TIMESTAMP WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL",
        [call.dbCallId, userId],
      );

      // 2. Notify remaining participants that this user has left
      call.participants.forEach((pId) => {
        const sId = activeUserSockets.get(pId);
        if (sId) {
          io.to(sId).emit("participant-left", { userId });
        }
      });
    }

    // 3. Determine if the call should end completely:
    // - Private call: ends if anyone leaves or rejects.
    // - Group call: ends if no active participants (size 0)
    //   OR only one person is left AND no one else is ringing (notifiedIds).
    const pendingCount = (call.notifiedIds || []).length;
    let shouldEnd = false;

    if (call.type === "private") {
      shouldEnd = true;
    } else {
      shouldEnd =
        call.participants.size === 0 ||
        (call.participants.size === 1 && pendingCount === 0);
    }

    if (shouldEnd) {
      // Notify remaining participants and anyone still ringing (notifiedIds)
      const notifyEnd = new Set([
        ...call.participants,
        ...(call.notifiedIds || []),
      ]);

      notifyEnd.forEach((pId) => {
        const sId = activeUserSockets.get(pId);
        if (sId) io.to(sId).emit("call-ended", { callId });
      });

      // Update DB for call ending
      await db.query(
        "UPDATE calls SET end_time = CURRENT_TIMESTAMP WHERE id = $1",
        [call.dbCallId],
      );

      // Notify clients to refresh logs
      io.to(`group_${call.groupId}`).emit("call-log-updated", {
        groupId: call.groupId,
      });

      activeCalls.delete(callId);
      console.log(`Call ${callId} fully ended.`);
    }
  }

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.user.id}`);
    activeUserSockets.delete(socket.user.id);

    // Clean up any calls the user was participating in
    activeCalls.forEach((call, callId) => {
      if (call.participants.has(socket.user.id)) {
        handleUserLeavingCall(socket.user.id, callId);
      }
    });
  });
});

// 📂 MEDIA UPLOAD
app.post("/api/upload", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fileUrl = `/uploads/${req.file.filename}`;
  let type = req.query.uploadType; // Use the type from query parameter

  // If uploadType is not explicitly set, infer from mimetype
  if (!type) {
    if (req.file.mimetype.startsWith("image/")) type = "image";
    else if (req.file.mimetype.startsWith("video/")) type = "video";
    else if (req.file.mimetype.startsWith("audio/")) type = "audio";
    else type = "document"; // Fallback for other file types if not explicitly 'document'
  } else if (type === "media") {
    if (req.file.mimetype.startsWith("image/")) type = "image";
    else if (req.file.mimetype.startsWith("video/")) type = "video";
    else if (req.file.mimetype.startsWith("audio/")) type = "audio";
    else {
      // Fallback: Guess type from extension if mimetype is generic (application/octet-stream)
      const ext = path.extname(req.file.originalname).toLowerCase();
      const imageExts = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".heic",
        ".heif",
      ];
      const videoExts = [".mp4", ".mov", ".avi", ".mkv"];
      const audioExts = [".mp3", ".wav", ".ogg", ".webm"];

      if (imageExts.includes(ext)) type = "image";
      else if (videoExts.includes(ext)) type = "video";
      else if (audioExts.includes(ext)) type = "audio";
      else type = "document";
    }
  }
  res.json({ success: true, file_url: fileUrl, type });
});

// 🔐 AUTH MIDDLEWARE
async function auth(req, res, next) {
  let token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token provided" });

  if (token.startsWith("Bearer ")) {
    // This is a common convention, keep it
    token = token.slice(7, token.length);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // This will give us id and role
    if (decoded.role === "admin") {
      const result = await db.query(
        `SELECT id, name, role FROM admins WHERE id = $1`,
        [decoded.id],
      );
      req.user = result.rows[0];
    } else {
      const result = await db.query(
        `SELECT id, name, role, active FROM users WHERE id = $1`,
        [decoded.id],
      );
      req.user = result.rows[0];
    }
    if (!req.user)
      return res.status(401).json({ error: "Invalid token or user not found" });
    next(); // Proceed if user is found
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// 🔑 REGISTER
app.post("/api/register", async (req, res) => {
  const { id, password, name } = req.body;

  try {
    // Check if user already exists
    const checkResult = await db.query("SELECT * FROM users WHERE id=$1", [id]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash the password and save the user
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (id, name, password, role) VALUES ($1, $2, $3, 'user')",
      [id, name, hash]
    );

    // Create a user object and sign a token for auto-login
    const user = { id, name, role: "user" };
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);

    res.json({ token, user });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// 🔑 LOGIN
app.post("/api/login", async (req, res) => {
  const { id, password } = req.body;

  const result = await db.query("SELECT * FROM users WHERE id=$1", [id]);

  let user;

  if (id === "admin") {
    const adminResult = await db.query("SELECT * FROM admins WHERE id=$1", [id]);
    if (adminResult.rows.length === 0) {
      return res.json({ error: "Admin user not found" });
    }
    user = adminResult.rows[0];
  } else {
    if (result.rows.length === 0) {
      return res.json({ error: "User not found" });
    }
    user = result.rows[0];
  }

  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.json({ error: "Wrong password" });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);

  res.json({ token, user });
});

// 👤 CREATE USER (ADMIN)
app.post("/api/admin/users/create", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });

    let { name, password, role } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }
    if (!role) role = "user";

    // Generate a unique ID (prefix + 5 digits): d for developer, u for user
    const prefix = role === "developer" ? "d" : "u";
    const id = prefix + Math.floor(10000 + Math.random() * 90000).toString();
    const hash = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (id, name, password, role, active) VALUES ($1, $2, $3, $4, true)",
      [id, name, hash, role]
    );

    // Return the new user object (excluding password)
    res.json({ id, name, role, active: 1 });
  } catch (err) {
    console.error("Create User Error:", err);
    res.status(500).json({ error: "Database error creating user" });
  }
});

// 👤 UPDATE USER (ADMIN)
app.patch("/api/admin/users/:id", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    const { name, role } = req.body;
    if (!name || !role)
      return res.status(400).json({ error: "Name and role are required" });

    await db.query("UPDATE users SET name=$1, role=$2 WHERE id=$3", [
      name,
      role,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database error updating user" });
  }
});

// 👤 DELETE USER (ADMIN)
app.delete("/api/admin/users/:id", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(400).json({ error: "Cannot delete default admin" });

    await db.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database error deleting user" });
  }
});

// 👤 TOGGLE USER STATUS (ADMIN)
app.patch("/api/admin/users/:id/status", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    const { active } = req.body;
    await db.query("UPDATE users SET active=$1 WHERE id=$2", [
      active,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database error updating status" });
  }
});

// 👥 GET ALL USERS (ADMIN)
app.get("/api/users", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    const result = await db.query(
      "SELECT id, name, role, active FROM users", // Admin can see all users
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching users" });
  }
});

// 👥 GET ALL USERS FOR ADMIN PANEL
app.get("/api/admin/users", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    const result = await db.query("SELECT id, name, role, active FROM users");
    res.json(result.rows);
  } catch (err) {
    // This is a duplicate of /api/users, should be consolidated or removed
    console.error(err);
    res.status(500).json({ error: "Database error fetching admin users" });
  }
});

// 👥 GET ALL GROUPS FOR ADMIN PANEL
app.get("/api/admin/groups", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });

    const result = await db.query(`
  SELECT 
    g.id, 
    g.name, 
    g.created_by, 
    g.group_call_enabled, 
    g.personal_call_enabled, 
    COUNT(gm.user_id) as member_count 
  FROM groups g
  LEFT JOIN group_members gm ON g.id = gm.group_id
  GROUP BY g.id, g.name, g.created_by, g.group_call_enabled, g.personal_call_enabled
`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching groups" });
  }
});

// 👥 UPDATE GROUP CALL FEATURES (ADMIN)
app.patch("/api/admin/groups/:id/call-features", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const updates = req.body;

    const fields = [];
    const values = [];
    if (updates.group_call_enabled !== undefined) {
      fields.push(`group_call_enabled = $${values.length + 1}`);
      values.push(updates.group_call_enabled);
    }
    if (updates.personal_call_enabled !== undefined) {
      fields.push(`personal_call_enabled = $${values.length + 1}`);
      values.push(updates.personal_call_enabled);
    }

    if (fields.length > 0) {
      values.push(id);
      await db.query(
        `UPDATE groups SET ${fields.join(", ")} WHERE id = $${values.length}`,
        values
      );
      // Notify members of the change in real-time
      io.to(`group_${id}`).emit("group-settings-updated", { id, ...updates });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error updating call features" });
  }
});

// 👥 CREATE GROUP (ADMIN)
app.post("/api/admin/groups", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Only admin" });

    const { name, memberIds } = req.body;

    const result = await db.query(
      "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id",
      [name, req.user.id],
    );

    const groupId = result.rows[0].id;

    for (let uId of memberIds) {
      await db.query(
        "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)",
        [groupId, uId],
      );
    }

    // Notify added members in real-time
    memberIds.forEach((uId) => {
      const targetSocketId = activeUserSockets.get(uId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("added-to-group", { groupName: name });
        io.to(targetSocketId).emit("groups-updated");
      }
    });

    res.json({
      id: groupId,
      name,
      created_by: req.user.id,
      member_count: memberIds.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error creating group" });
  }
});

// 👥 DELETE GROUP (ADMIN)
app.delete("/api/admin/groups/:id", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Only admin" });
    const groupId = req.params.id;

    // Get members list before deletion to notify them
    const memberResult = await db.query(
      "SELECT user_id FROM group_members WHERE group_id = $1",
      [groupId],
    );

    // Delete associated data first
    await db.query("DELETE FROM messages WHERE group_id = $1", [groupId]);
    await db.query("DELETE FROM group_members WHERE group_id = $1", [groupId]);

    // Cleanup call history
    await db.query(
      "DELETE FROM call_participants WHERE call_id IN (SELECT id FROM calls WHERE group_id = $1)",
      [groupId],
    );
    await db.query("DELETE FROM calls WHERE group_id = $1", [groupId]);

    await db.query("DELETE FROM groups WHERE id = $1", [groupId]);

    // Notify former members so their UI updates
    memberResult.rows.forEach((m) => {
      const targetSocketId = activeUserSockets.get(m.user_id);
      if (targetSocketId) {
        io.to(targetSocketId).emit("groups-updated", {
          deleted: true,
          groupId: groupId,
        });
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error deleting group" });
  }
});

// 👥 GET GROUP MEMBERS
app.get("/api/groups/:groupId/members", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await db.query(
      `
            SELECT u.id, u.name, u.role
            FROM users u
            WHERE u.id IN (SELECT user_id FROM group_members WHERE group_id = $1)
            UNION
            SELECT a.id, a.name, a.role
            FROM admins a
            WHERE a.id = (SELECT created_by FROM groups WHERE id = $2)
        `,
      [groupId, groupId],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching members" });
  }
});

// 👥 ADD MEMBER TO GROUP (ADMIN)
app.post("/api/groups/:groupId/members", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Only admin" });
    const { groupId } = req.params;
    const { userId } = req.body;

    await db.query(
      "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)",
      [groupId, userId],
    );

    // Notify user in real-time
    const groupResult = await db.query("SELECT name FROM groups WHERE id = $1", [
      groupId,
    ]);
    const targetSocketId = activeUserSockets.get(userId);
    if (targetSocketId && groupResult.rows.length > 0) {
      io.to(targetSocketId).emit("added-to-group", {
        groupName: groupResult.rows[0].name,
      });
      io.to(targetSocketId).emit("groups-updated");
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error adding member" });
  }
});

// 👥 REMOVE MEMBER FROM GROUP (ADMIN)
app.delete("/api/groups/:groupId/members/:userId", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Only admin" });
    const { groupId, userId } = req.params;

    const groupResult = await db.query(
      "SELECT name FROM groups WHERE id = $1",
      [groupId],
    );

    await db.query(
      "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );

    // Notify user in real-time
    const targetSocketId = activeUserSockets.get(userId);
    if (targetSocketId && groupResult.rows.length > 0) {
      io.to(targetSocketId).emit("removed-from-group", {
        groupId: groupId,
        groupName: groupResult.rows[0].name,
      });
      io.to(targetSocketId).emit("groups-updated", {
        removed: true,
        groupId: groupId,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error removing member" });
  }
});

// 💬 GET GROUP MESSAGES
app.get("/api/groups/:groupId/messages", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await db.query(
      `
            SELECT m.*, COALESCE(u.name, a.name, 'Unknown') as user_name, COALESCE(u.role, a.role, 'Unknown') as user_role 
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.id
            LEFT JOIN admins a ON m.user_id = a.id
            WHERE m.group_id = $1
            ORDER BY m.id ASC
        `,
      [groupId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Error fetching messages" });
  }
});

// 💬 SEND MESSAGE TO GROUP
app.post("/api/groups/:groupId/messages", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content } = req.body;

    await db.query(
      "INSERT INTO messages (group_id, user_id, content) VALUES ($1, $2, $3)",
      [groupId, req.user.id, content],
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error sending message" });
  }
});

// 👥 GET MY GROUPS
app.get("/api/my-groups", auth, async (req, res) => {
  try {
    const result = await db.query(
      `
          SELECT g.*, 
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
          FROM groups g
          JOIN group_members gm ON g.id = gm.group_id
          WHERE gm.user_id=$1
      `,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching my-groups:", err);
    res.status(500).json({ error: "Database error fetching groups" });
  }
});

// 💬 GET CALL HISTORY
app.get("/api/groups/:groupId/calls", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await db.query(
      `
        SELECT 
            c.id, c.group_id, c.caller_id, c.type, c.start_time, c.end_time,
            STRING_AGG(COALESCE(u.name, a.name, 'Unknown'), ', ') as participant_names,
            EXTRACT(EPOCH FROM (c.end_time - c.start_time)) as duration_seconds
        FROM calls c
        JOIN call_participants cp ON c.id = cp.call_id
        LEFT JOIN users u ON cp.user_id = u.id
        LEFT JOIN admins a ON cp.user_id = a.id
        WHERE c.group_id = $1 AND c.end_time IS NOT NULL
        GROUP BY c.id, c.group_id, c.caller_id, c.type, c.start_time, c.end_time
        ORDER BY c.start_time DESC
      `,
      [groupId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching call history" });
  }
});

// Profile Update Endpoint
app.patch("/api/profile", auth, async (req, res) => {
  const { name, profile_image } = req.body;
  const userId = req.user.id; // Get ID from the authenticated token

  try {
    // Fetch current user data
    const result = await db.query(
      "SELECT name, profile_image FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const currentName = result.rows[0].name;
    const currentImage = result.rows[0].profile_image;

    const updatedName = name !== undefined ? name : currentName;
    const updatedImage =
      profile_image !== undefined ? profile_image : currentImage;

    let sql;
    if (req.user.role === "admin") {
      sql = "UPDATE admins SET name = $1, profile_image = $2 WHERE id = $3";
    } else {
      sql = "UPDATE users SET name = $1, profile_image = $2 WHERE id = $3";
    }

    await db.query(sql, [updatedName, updatedImage, userId]);

    res.json({
      success: true,
      message: "Profile updated",
      user: { name: updatedName, profile_image: updatedImage },
    });
  } catch (err) {
    console.error("Profile Update Error:", err);
    res
      .status(500)
      .json({ error: "Failed to update database: " + err.message });
  }
});

async function startServer() {
  try {
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    console.log("✅ PostgreSQL Connected and Pool Created");

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup Error:", err);
    process.exit(1);
  }
}

startServer();
