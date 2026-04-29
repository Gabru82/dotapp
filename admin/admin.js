// Protect the route - now checks token too
if (
  localStorage.getItem("admin_isLoggedIn") !== "true" ||
  !localStorage.getItem("admin_token")
) {
  window.location.href = "index.html";
}

function logout() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_user");
  localStorage.removeItem("admin_isLoggedIn");
  window.location.href = "/admin/index.html";
}

// Configuration
const API_BASE_URL = "https://dotapp.onrender.com";

// Initialize Socket.io Connection
const socket = io(API_BASE_URL, {
  auth: { token: localStorage.getItem("admin_token") },
});

let currentActiveGroupId = null;
// WebRTC State
let localStream = null;
let peerConnections = {}; // remoteUserId -> RTCPeerConnection
let isMuted = false;
let currentCall = null; // { callId, type, groupId, callerId, participants: [] }
let pendingCall = null; // Tracks an incoming call before it's accepted
let incomingCallTimeout = null;

const iceServers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Listen for real-time messages
socket.on("new-message", (msg) => {
  if (currentActiveGroupId && msg.group_id == currentActiveGroupId) {
    const chatBox = document.getElementById("chat-box");
    if (chatBox) {
      const adminUser = JSON.parse(localStorage.getItem("admin_user") || "{}");
      const isMe = msg.user_id === adminUser.id;
      let contentHtml = msg.content || "";
      let fileName = ""; // To store file name for documents

      if (msg.type === "image") {
        contentHtml = `<img src="${msg.file_url}" style="max-width: 100%; border-radius: 8px; display: block;">`;
      } else if (msg.type === "video") {
        contentHtml = `<video src="${msg.file_url}" controls style="max-width: 100%; border-radius: 8px; display: block;"></video>`;
      } else if (msg.type === "audio") {
        // New: Audio rendering
        contentHtml = `<audio controls src="${msg.file_url}" style="max-width: 100%; display: block;"></audio>`;
      } else if (msg.type === "document") {
        // New: Document rendering
        // Extract filename from URL for display
        fileName = msg.file_url.substring(msg.file_url.lastIndexOf("/") + 1);
        // Basic rendering for documents, can be enhanced with file type icons
        contentHtml = `<a href="${msg.file_url}" target="_blank" style="color: inherit; text-decoration: underline;"><i class="fas fa-file"></i> ${fileName}</a>`;
      }

      const msgHtml = `
        <div style="margin-bottom: 1rem; text-align: ${isMe ? "right" : "left"}">
            <div style="font-size: 0.7rem; color: var(--text-muted);">${msg.user_name} (${msg.user_role})</div>
            <div style="display: inline-block; padding: 8px 12px; border-radius: 12px; background: ${isMe ? "var(--primary)" : "var(--bg-body)"}; color: ${isMe ? "white" : "inherit"}; margin-top: 4px; max-width: 80%;">
                ${contentHtml}
            </div>
        </div>
      `;
      chatBox.insertAdjacentHTML("beforeend", msgHtml);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  }
});

socket.on("message-updated", (data) => {
    const bubble = document.querySelector(`.msg-item[data-id="${data.messageId}"] .msg-text`);
    if (bubble) {
        bubble.innerText = data.content;
        if (!bubble.parentNode.querySelector('.edited-tag')) {
            const tag = document.createElement('div');
            tag.className = 'edited-tag';
            tag.style.cssText = "font-size: 0.65rem; opacity: 0.6; text-align: right; margin-top: 4px;";
            tag.innerText = "edited";
            bubble.parentNode.appendChild(tag);
        }
    }
});

socket.on("message-deleted", (data) => {
    const msgEl = document.querySelector(`.msg-item[data-id="${data.messageId}"]`);
    if (msgEl) msgEl.remove();
});

// API helper
async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem("admin_token");
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...options,
  };
  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  if (response.status === 401) {
    logout();
    return;
  }
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "API error");
  }
  return response.json();
}

// UI Logic & Navigation
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Security Check: If no token, redirect back to login
  const token = localStorage.getItem("admin_token");
  const isLoggedIn = localStorage.getItem("admin_isLoggedIn");

  if (!token || isLoggedIn !== "true") {
    window.location.href = "index.html";
    return;
  }

  // Define state variables at the top of the scope
  const user = JSON.parse(localStorage.getItem("admin_user") || "{}");
  let users = [];
  let groups = [];
  const contentArea = document.getElementById("dynamic-content");
  const navItems = document.querySelectorAll(".nav-item[data-section]");
  const themeBtn = document.getElementById("theme-toggle");

  // WebRTC Call Event Listeners
  // Mobile Sidebar Toggle Logic
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const dashboardContainer = document.querySelector(".dashboard-container");

  if (sidebarToggle) {
    sidebarToggle.onclick = () => dashboardContainer.classList.add("sidebar-open");
  }

  if (sidebarOverlay) {
    sidebarOverlay.onclick = () => dashboardContainer.classList.remove("sidebar-open");
  }

  socket.on("incoming-call", (data) => {
    if (data.callerId === user.id) return;
    if (currentCall || pendingCall) {
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "busy",
      });
      return;
    }
    pendingCall = data;
    showIncomingCallModal(data);
    incomingCallTimeout = setTimeout(() => {
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "no_answer",
      });
      hideIncomingCallModal();
      pendingCall = null;
    }, 30000);
  });

  socket.on("call-accepted", async (data) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    pendingCall = null;

    const isNewCall = !currentCall || currentCall.callId !== data.callId;
    currentCall = data; // Always update to get authoritative participant list

    if (isNewCall) {
      showCallUI();
    }

    for (const participantId of data.participants) {
      if (participantId !== user.id && !peerConnections[participantId]) {
        // Use deterministic initiation: user with "smaller" ID initiates.
        // This ensures full mesh connectivity in group calls.
        const isInitiator = user.id < participantId;
        console.log(`Establishing PC with ${participantId}, isInitiator: ${isInitiator}`);
        await createPeerConnection(participantId, isInitiator, data.groupId);
      }
    }
  });

  socket.on("webrtc-signal", async (data) => {
    if (!currentCall || !localStream) return;

    if (!peerConnections[data.from]) {
      await createPeerConnection(data.from, false, data.groupId);
    }

    const pc = peerConnections[data.from];
    if (!pc) return;

    try {
      if (data.signal.type === "offer") {
        if (pc.signalingState !== "stable") return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-signal", {
          to: data.from,
          signal: answer,
          groupId: data.groupId,
        });
      } else if (data.signal.type === "answer") {
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
      } else if (data.signal.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      }
    } catch (error) {
      console.error("WebRTC signal error:", error);
    }
  });

  socket.on("participant-left", (data) => {
    const pc = peerConnections[data.userId];
    if (pc) {
      pc.close();
      delete peerConnections[data.userId];
    }
    const audioTag = document.getElementById(`audio-${data.userId}`);
    if (audioTag) {
      audioTag.remove();
    }
  });

  socket.on("call-rejected", (data) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    if (currentCall && currentCall.type === "private") {
      window.endCall();
    }
  });

  socket.on("call-missed", (data) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    if (currentCall && currentCall.callerId === user.id) {
      window.endCall();
    }
  });

  socket.on("call-ended", (data) => {
    if (currentCall && currentCall.callId === data.callId) {
      window.endCall();
    }
    // Cancel incoming call if the caller hung up before we answered
    if (pendingCall && pendingCall.callId === data.callId) {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      pendingCall = null;
    }
  });

  socket.on("call-log-updated", (data) => {
    if (
      currentActiveGroupId == data.groupId &&
      document.querySelector(".ch-overlay")
    ) {
      // If the call history modal is open, refresh it
      window.showCallHistory(data.groupId);
    }
  });

  socket.on("call-error", (msg) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    showToast(msg);
  });

  // Real-time listener to handle account deletion or forced logouts
  socket.on("force-logout", () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    localStorage.removeItem("admin_isLoggedIn");
    window.location.href = "/admin/index.html";
  });

  // Group settings sync
  socket.on("group-settings-updated", (data) => {
    const group = groups.find((g) => g.id == data.id);
    if (group) {
      if (data.group_call_enabled !== undefined)
        group.group_call_enabled = data.group_call_enabled;
      if (data.personal_call_enabled !== undefined)
        group.personal_call_enabled = data.personal_call_enabled;

      if (currentActiveGroupId == data.id) {
        // Re-render part of UI if needed, or simply update data
        // For admin, refreshing group view is easiest
        window.renderGroupDetail(data.id);
      }
    }
  });

  // 3. Logout Functionality
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  const loadUsers = async () => {
    users = await apiCall("/api/admin/users");
  };
  const loadGroups = async () => {
    groups = await apiCall("/api/admin/groups");
  };

  // Theme Management (unchanged)
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeIcon(next);
  });

  // Search Functionality
  const searchInput = document.querySelector(".search-box input");
  const searchResults = document.createElement("div");
  searchResults.className = "search-results-overlay";
  document.querySelector(".search-box").appendChild(searchResults);

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      searchResults.style.display = "none";
      if (document.getElementById("user-list")) renderUsers();
      return;
    }

    const filtered = users.filter(u => 
      u.name.toLowerCase().includes(query) || 
      u.id.toLowerCase().includes(query) ||
      (u.role && u.role.toLowerCase().includes(query))
    );

    if (document.getElementById("user-list")) renderUsers(filtered);

    if (filtered.length > 0) {
      searchResults.innerHTML = filtered.slice(0, 8).map(u => `
        <div class="search-result-item" onclick="window.openEditModal('${u.id}'); document.querySelector('.search-results-overlay').style.display='none';">
          <div class="res-info">
            <strong>${u.name}</strong>
            <span>${u.role || 'user'}</span>
          </div>
          <small>${u.id}</small>
        </div>
      `).join("");
      searchResults.style.display = "block";
    } else {
      searchResults.innerHTML = '<div style="padding: 10px; color: var(--text-muted); font-size: 0.8rem;">No matches found</div>';
      searchResults.style.display = "block";
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) searchResults.style.display = "none";
  });

  function updateThemeIcon(theme) {
    themeBtn.innerHTML =
      theme === "dark"
        ? '<i class="fas fa-sun"></i>'
        : '<i class="fas fa-moon"></i>';
  }

  // Sections Content (updated for dynamic stats)
  const sections = {
    dashboard: async () => {
      const totalUsers = users.length;
      const activeUsers = users.filter((u) => u.active == 1).length;
      const developerUsers = users.filter((u) => u.role === "developer").length;
      const deactiveUsers = totalUsers - activeUsers;
      const totalGroups = groups.length;

      return `
                <div class="section-fade">
                    <h2 style="margin-bottom: 2rem;">Dashboard Overview</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon"><i class="fas fa-users"></i></div>
                            <div class="stat-info"><h3>${totalUsers}</h3><p>Total Users</p></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon"><i class="fas fa-layer-group"></i></div>
                            <div class="stat-info"><h3>${totalGroups}</h3><p>Total Groups</p></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon"><i class="fas fa-user-check"></i></div>
                            <div class="stat-info"><h3>${activeUsers}</h3><p>Active Accounts</p></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon" style="color: #6f42c1;"><i class="fas fa-code"></i></div>
                            <div class="stat-info"><h3>${developerUsers}</h3><p>Developers</p></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon"><i class="fas fa-user-slash"></i></div>
                            <div class="stat-info"><h3>${deactiveUsers}</h3><p>Deactive Accounts</p></div>
                        </div>
                    </div>
                </div>
            `;
    },
    users: `
            <div class="section-fade">
                <div class="user-header">
                    <h2>Users Management</h2>
                    <button class="btn-add" id="open-modal-btn"><i class="fas fa-plus"></i> Add User</button>
                </div>
                <div class="table-container">
                    <table class="user-table">
                        <thead>
                            <tr>
                                <th>User ID</th>
                                <th>Name & Role</th>
                                <th>Password</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="user-list"></tbody>
                    </table>
                </div>
            </div>
        `,
    groups: `
            <div class="section-fade">
                <div class="groups-header">
                    <h2>Groups Management</h2>
                    <button class="btn-add" id="open-group-modal-btn"><i class="fas fa-plus"></i> Create Group</button>
                </div>
                <div class="groups-grid" id="groups-list"></div>
            </div>
        `,
  };

  async function renderUsers(data = users) {
    const list = document.getElementById("user-list");
    if (!list) return;

    list.innerHTML = data
      .map(
        (user) => `
            <tr>
                <td style="font-family: monospace; font-weight: 600; color: var(--primary);">${user.id}</td>
                <td>
                    <div style="font-weight: 500;">${user.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: bold;">${user.role || "user"}</div>
                </td>
                <td style="color: var(--text-muted); letter-spacing: 2px;">••••••</td>
                <td>
                    <label class="switch">
                        <input type="checkbox" ${user.active ? "checked" : ""} onchange="window.toggleUser('${user.id}')">
                        <span class="slider"></span>
                    </label>
                </td>
                <td>
                    <button class="edit-btn" onclick="window.openEditModal('${user.id}')"><i class="fas fa-edit"></i></button>
                </td>
            </tr>
        `,
      )
      .join("");
  }

  window.toggleUser = async (id) => {
    try {
      await apiCall(`/api/admin/users/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          active: !users.find((u) => u.id === id).active,
        }),
      });
      await loadUsers();
      renderUsers();
    } catch (err) {
      showAlert("Toggle failed: " + err.message);
    }
  };

  function renderGroups() {
    const list = document.getElementById("groups-list");
    if (!list) return;
    list.innerHTML = groups
      .map(
        (group) => `
            <div class="group-card" onclick="window.renderGroupDetail('${group.id}')" style="position: relative;">
                <button class="icon-btn" 
                        onclick="event.stopPropagation(); window.deleteGroup('${group.id}', '${group.name}')" 
                        style="position: absolute; top: 1rem; right: 1rem; color: #ff4d4d; z-index: 5;" 
                        title="Delete Group">
                    <i class="fas fa-trash-alt"></i>
                </button>
                <h3>${group.name}</h3>
                <p><i class="fas fa-users"></i> ${group.member_count || 0} Members</p>
                <p style="margin-top: 0.5rem; font-size: 0.75rem;"><i class="fas fa-user"></i> by Admin</p>
            </div>
            <div class="group-features" style="display: flex; justify-content: space-around; padding: 0.5rem 0; border-top: 1px solid var(--border); margin-top: 0.5rem;">
                <div style="text-align: center;">
                    <label class="switch small">
                        <input type="checkbox" ${group.group_call_enabled ? "checked" : ""} onchange="window.toggleGroupCallFeature('${group.id}', 'group_call_enabled', this.checked)">
                        <span class="slider round"></span>
                    </label>
                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">Group Call</div>
                </div>
                <div style="text-align: center;">
                    <label class="switch small">
                        <input type="checkbox" ${group.personal_call_enabled ? "checked" : ""} onchange="window.toggleGroupCallFeature('${group.id}', 'personal_call_enabled', this.checked)">
                        <span class="slider round"></span>
                    </label>
                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">Personal Call</div>
                </div>
            </div>
        `,
      )
      .join("");
  }

  window.toggleGroupCallFeature = async (groupId, featureName, isEnabled) => {
    try {
      await apiCall(`/api/admin/groups/${groupId}/call-features`, {
        method: "PATCH",
        body: JSON.stringify({ [featureName]: isEnabled }),
      });
      await loadGroups(); // Reload groups to update UI
      renderGroups();
      showToast(
        `Group ${featureName.replace("_", " ")} ${isEnabled ? "enabled" : "disabled"}`,
      );
    } catch (err) {
      showAlert("Failed to update call feature: " + err.message);
    }
  };

  window.deleteGroup = async (id, name) => {
    if (
      !(await showAlert(
        `Are you sure you want to delete group "${name}" and all its messages permanently?`,
      ))
    )
      return;
    try {
      await apiCall(`/api/admin/groups/${id}`, { method: "DELETE" });
      await loadGroups();
      renderGroups();
      showToast(`Group "${name}" deleted`);
    } catch (err) {
      showAlert("Delete failed: " + err.message);
    }
  };

  // Group detail simplified (no messages storage yet)
  window.renderGroupDetail = async (groupId) => {
    const group = groups.find((g) => g.id == groupId);
    if (!group) return;

    // Join the real-time room for this group
    currentActiveGroupId = groupId;
    socket.emit("join-group", groupId);

    try {
      const [messages, members] = await Promise.all([
        apiCall(`/api/groups/${groupId}/messages`),
        apiCall(`/api/groups/${groupId}/members`),
      ]);

      // Filter users who are not already in the group for the "Add Member" list
      const nonMembers = users.filter(
        (u) => !members.find((m) => m.id === u.id),
      );

      contentArea.innerHTML = `
            <div class="section-fade">
                <div class="groups-header">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <button class="icon-btn" onclick="window.renderSection('groups')"><i class="fas fa-arrow-left"></i></button>
                        <h2 style="margin-right: 10px;">${group.name}</h2>
                        ${
                          group.group_call_enabled
                            ? `
                          <button class="icon-btn" onclick="window.startAudioCall('group', '${group.id}')" title="Start Group Call" style="color: var(--primary);">
                            <i class="fas fa-phone"></i>
                          </button>
                        `
                            : ""
                        }
                        ${
                          group
                            ? `
                          <button class="icon-btn" onclick="window.showCallHistory('${group.id}')" title="Call History" style="color: var(--text-muted);">
                            <i class="fas fa-ellipsis-v"></i>
                          </button>
                        `
                            : ""
                        }
                    </div>
                </div>
                <div class="group-detail-view" style="display: flex; height: 70vh; gap: 1rem;">
                    <div class="chat-main" style="flex: 1; display: flex; flex-direction: column; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border);">
                        <div class="chat-messages" id="chat-box" style="flex: 1; padding: 1rem; overflow-y: auto;">
                            ${
                              messages.length === 0
                                ? '<div style="text-align: center; color: var(--text-muted); padding-top: 2rem;">No messages yet</div>'
                                : messages
                                    .map((m) => {
                                      let contentHtml = m.content || "";
                                      if (m.type === "image")
                                        contentHtml = `<img src="${m.file_url}" style="max-width: 100%; border-radius: 8px; display: block;">`;
                                      else if (m.type === "video")
                                        contentHtml = `<video src="${m.file_url}" controls style="max-width: 100%; border-radius: 8px; display: block;"></video>`;
                                      else if (m.type === "audio")
                                        contentHtml = `<audio controls src="${m.file_url}" style="max-width: 100%; display: block;"></audio>`; // New: Audio rendering
                                      else if (m.type === "document") {
                                        // New: Document rendering
                                        const fileName = m.file_url.substring(
                                          m.file_url.lastIndexOf("/") + 1,
                                        );
                                        contentHtml = `<a href="${m.file_url}" target="_blank" style="color: inherit; text-decoration: underline;"><i class="fas fa-file"></i> ${fileName}</a>`;
                                        // Note: The original code had `fileName` defined here, but used outside this block. Moved definition to `new-message` listener.
                                      }

                                      return `
                                  <div class="msg-item" data-id="${m.id}" data-type="${m.type}" style="margin-bottom: 1rem; text-align: ${m.user_id === user.id ? "right" : "left"}">
                                      <div style="font-size: 0.7rem; color: var(--text-muted);">
                                        ${m.user_name} (${m.user_role})
                                        ${m.type === "document" ? `<span style="font-size: 0.6rem; margin-left: 5px;">(${fileName})</span>` : ""}
                                      </div>
                                      <div class="msg-bubble" style="display: inline-block; padding: 8px 12px; border-radius: 12px; background: ${m.user_id === user.id ? "var(--primary)" : "var(--bg-body)"}; color: ${m.user_id === user.id ? "white" : "inherit"}; margin-top: 4px; max-width: 80%;">
                                          <div class="msg-text">${contentHtml}</div>
                                      </div>
                                  </div>
                                `;
                                    })
                                    .join("")
                            }
                        </div>
                        <div class="chat-input-area" style="padding: 1rem; border-top: 1px solid var(--border); display: flex; gap: 0.5rem; align-items: center;">
                            <button class="icon-btn" id="plus-options-btn" title="Attach File" style="color: var(--primary);"><i class="fas fa-plus"></i></button>
                            
                            <input type="text" id="chat-input" placeholder="Type a message..." style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit;">
                            <button class="btn-add" id="send-msg-btn"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    </div>
                    <div class="group-sidebar" style="width: 250px; background: var(--bg-card); border-radius: 8px; padding: 1rem; border: 1px solid var(--border); display: flex; flex-direction: column;">
                        <h4>Members (${members.length})</h4>
                        <div style="flex: 1; overflow-y: auto; margin-top: 1rem;">
                            ${members
                              .map(
                                (m) => ` 
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);">
                                    <div>
                                        <div style="font-size: 0.85rem; font-weight: 500;">${m.name}</div>
                                        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: capitalize;">${m.role}</div>
                                    </div>
                                    <div style="display: flex; gap: 5px;">
                                      ${
                                        group.personal_call_enabled &&
                                        m.id !== user.id
                                          ? `
                                        <button class="icon-btn" style="color: var(--primary); opacity: 0.8;" onclick="window.startAudioCall('private', '${groupId}', false, '${m.id}')" title="Call User"><i class="fas fa-phone"></i></button>
                                      `
                                          : ""
                                      }
                                    <button class="icon-btn" style="color: #ff4d4d; opacity: 0.8;" onclick="window.removeMember('${groupId}', '${m.id}')" title="Remove User"><i class="fas fa-user-minus"></i></button>
                                    </div>
                                </div>
                            `,
                              )
                              .join("")}
                        </div>
                        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                            <p style="font-size: 0.8rem; font-weight: 600; margin-bottom: 0.5rem;">Add New Member</p>
                            <div style="display: flex; gap: 0.5rem;">
                                <select id="add-member-select" style="flex: 1; padding: 6px; border-radius: 4px; background: var(--bg-body); color: inherit; border: 1px solid var(--border); font-size: 0.85rem;">
                                    <option value="">Select User...</option>
                                    ${nonMembers.map((u) => `<option value="${u.id}">${u.name} [${u.role.toUpperCase()}]</option>`).join("")}
                                </select>
                                <button class="btn-add" style="padding: 4px 10px;" onclick="window.addMember('${groupId}')"><i class="fas fa-plus"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- File Upload Options Modal -->
            <div id="file-options-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="width: 250px; padding: 1rem;">
                    <h4 style="margin-bottom: 1rem;">Send File</h4>
                    <button id="send-media-btn" class="btn-add" style="width: 100%; margin-bottom: 0.5rem;"><i class="fas fa-image"></i> Send Media</button>
                    <button id="send-document-btn" class="btn-add" style="width: 100%; margin-bottom: 0.5rem;"><i class="fas fa-file-alt"></i> Send Document</button>
                    <button id="record-voice-btn" class="btn-add" style="width: 100%;"><i class="fas fa-microphone"></i> Record Voice</button>
                    <button class="btn-cancel" style="width: 100%; margin-top: 1rem;" onclick="closeModal('file-options-modal')">Cancel</button>
                </div>
            </div>
            <!-- Hidden File Inputs -->
            <input type="file" id="media-input" style="display: none;" accept="image/*,video/*,audio/*">
            <input type="file" id="document-input" style="display: none;" accept="*/*">
            <!-- Voice Recording UI -->
            <div id="voice-recorder-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="width: 300px; padding: 1.5rem; text-align: center;">
                    <h4 id="recording-status">Recording...</h4>
                    <div style="margin: 1.5rem 0;">
                        <button id="stop-recording-btn" class="btn-cancel" style="background: #dc3545; color: white; margin-right: 1rem;"><i class="fas fa-stop"></i> Stop</button>
                        <button id="send-recording-btn" class="btn-add" style="display: none;"><i class="fas fa-paper-plane"></i> Send</button>
                        <audio id="audio-preview" controls style="display: none; width: 100%; margin-top: 1rem;"></audio>
                    </div>
                    <button class="btn-cancel" onclick="closeModal('voice-recorder-modal'); stopRecording(true);">Cancel</button>
                </div>
            </div>
        `;

      const msgInput = document.getElementById("chat-input");
      const sendBtn = document.getElementById("send-msg-btn");
      const chatBox = document.getElementById("chat-box");

      // New elements for file options
      const plusOptionsBtn = document.getElementById("plus-options-btn");
      const fileOptionsModal = document.getElementById("file-options-modal");
      const sendMediaBtn = document.getElementById("send-media-btn");
      const sendDocumentBtn = document.getElementById("send-document-btn");
      const recordVoiceBtn = document.getElementById("record-voice-btn");
      const mediaInput = document.getElementById("media-input");
      const documentInput = document.getElementById("document-input");

      // Voice recording elements
      const voiceRecorderModal = document.getElementById(
        "voice-recorder-modal",
      );
      const recordingStatus = document.getElementById("recording-status");
      const stopRecordingBtn = document.getElementById("stop-recording-btn");
      const sendRecordingBtn = document.getElementById("send-recording-btn");
      const audioPreview = document.getElementById("audio-preview");

      let mediaRecorder;
      let audioChunks = [];
      let audioBlob;

      chatBox.scrollTop = chatBox.scrollHeight;

      const handleSend = async () => {
        const content = msgInput.value.trim();
        if (!content) return;

        // Send via Socket for real-time broadcast and DB save
        socket.emit("send-message", { groupId, content });
        msgInput.value = "";
      };

      sendBtn.onclick = handleSend;
      msgInput.onkeyup = (e) => {
        if (e.key === "Enter") handleSend();
      };

      // Long Press for Admin chat view
      let adminPressTimer;
      chatBox.addEventListener("mousedown", (e) => startAdminPress(e));
      chatBox.addEventListener("touchstart", (e) => startAdminPress(e));
      chatBox.addEventListener("mouseup", () => clearTimeout(adminPressTimer));
      chatBox.addEventListener("mouseleave", () => clearTimeout(adminPressTimer));
      chatBox.addEventListener("touchend", () => clearTimeout(adminPressTimer));

      function startAdminPress(e) {
          const item = e.target.closest('.msg-item');
          if (!item || item.style.textAlign !== "right") return; 

          adminPressTimer = setTimeout(() => {
              showAdminMsgOptions(item);
          }, 700);
      }

      async function showAdminMsgOptions(el) {
          const msgId = el.dataset.id;
          const type = el.dataset.type;
          const overlay = document.createElement('div');
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:11000;";
          overlay.innerHTML = `
            <div style="background:var(--bg-card); padding:20px; border-radius:12px; text-align:center; min-width:200px; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <h4 style="margin-bottom:15px; color:var(--text-main);">Options</h4>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${type === 'text' ? '<button id="adm-edit" style="width:100%; padding:10px; background:var(--primary); color:white; border:none; border-radius:5px; cursor:pointer;">Edit</button>' : ''}
                    <button id="adm-del" style="width:100%; padding:10px; background:#dc3545; color:white; border:none; border-radius:5px; cursor:pointer;">Delete</button>
                    <button id="adm-can" style="width:100%; padding:10px; background:#6c757d; color:white; border:none; border-radius:5px; cursor:pointer;">Cancel</button>
                </div>
            </div>
          `;
          document.body.appendChild(overlay);
          
          if (type === 'text') {
              overlay.querySelector('#adm-edit').onclick = () => {
                  overlay.remove();
                  const old = el.querySelector('.msg-text').innerText;
                  const val = prompt("Edit message:", old);
                  if (val !== null && val.trim() !== "" && val.trim() !== old) {
                      socket.emit("edit-message", { messageId: msgId, content: val.trim(), groupId: currentActiveGroupId });
                  }
              };
          }
          
          overlay.querySelector('#adm-del').onclick = async () => {
              overlay.remove();
              if (await showAlert("Delete this message?")) {
                  socket.emit("delete-message", { messageId: msgId, groupId: currentActiveGroupId });
              }
          };
          
          overlay.querySelector('#adm-can').onclick = () => overlay.remove();
          overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
      };

      // Plus button to open options modal
      plusOptionsBtn.onclick = () => {
        fileOptionsModal.style.display = "flex";
      };

      // Option handlers
      sendMediaBtn.onclick = () => {
        mediaInput.click();
        closeModal("file-options-modal");
      };
      sendDocumentBtn.onclick = () => {
        documentInput.click();
        closeModal("file-options-modal");
      };
      recordVoiceBtn.onclick = async () => {
        closeModal("file-options-modal");
        await startRecording();
      };

      // Media Input Change (image/video/audio)
      mediaInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024)
          return showAlert("File size exceeds 10MB limit");

        const formData = new FormData();
        formData.append("file", file);

        plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        plusOptionsBtn.disabled = true;

        try {
          const res = await fetch(
            `${API_BASE_URL}/api/upload?uploadType=media`,
            {
              // Pass uploadType
              method: "POST",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
              },
              body: formData,
            },
          );
          const data = await res.json();
          if (data.success) {
            socket.emit("send-message", {
              groupId,
              type: data.type,
              file_url: data.file_url,
            }); // Type inferred from server
          } else showAlert(data.error || "Upload failed");
        } catch (err) {
          showAlert("Error uploading media file");
        } finally {
          plusOptionsBtn.innerHTML = '<i class="fas fa-plus"></i>';
          plusOptionsBtn.disabled = false;
          mediaInput.value = "";
        }
      };

      // Document Input Change (all types)
      documentInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024)
          return showAlert("File size exceeds 10MB limit");

        const formData = new FormData();
        formData.append("file", file);

        plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        plusOptionsBtn.disabled = true;

        try {
          const res = await fetch(
            `${API_BASE_URL}/api/upload?uploadType=document`,
            {
              // Pass uploadType
              method: "POST",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
              },
              body: formData,
            },
          );
          const data = await res.json();
          if (data.success) {
            socket.emit("send-message", {
              groupId,
              type: "document",
              file_url: data.file_url,
            }); // Force type 'document'
          } else showAlert(data.error || "Upload failed");
        } catch (err) {
          showAlert("Error uploading document file");
        } finally {
          plusOptionsBtn.innerHTML = '<i class="fas fa-plus"></i>';
          plusOptionsBtn.disabled = false;
          documentInput.value = "";
        }
      };

      // Voice Recording Functions
      async function startRecording() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          audioBlob = null;

          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };

          mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            const audioUrl = URL.createObjectURL(audioBlob);
            audioPreview.src = audioUrl;
            audioPreview.style.display = "block";
            sendRecordingBtn.style.display = "inline-block";
            recordingStatus.innerText = "Recording stopped. Preview and send.";
            stream.getTracks().forEach((track) => track.stop()); // Stop microphone access
          };

          mediaRecorder.start();
          voiceRecorderModal.style.display = "flex";
          recordingStatus.innerText = "Recording...";
          stopRecordingBtn.style.display = "inline-block";
          sendRecordingBtn.style.display = "none";
          audioPreview.style.display = "none";
          audioPreview.src = "";
        } catch (err) {
          showAlert("Could not start recording: " + err.message);
          closeModal("voice-recorder-modal");
        }
      }

      window.stopRecording = (cancel = false) => {
        // Make it global for HTML onclick
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
        if (cancel) {
          closeModal("voice-recorder-modal");
          if (audioPreview.src) URL.revokeObjectURL(audioPreview.src);
          audioChunks = [];
          audioBlob = null;
        }
      };

      stopRecordingBtn.onclick = () => window.stopRecording(false);

      sendRecordingBtn.onclick = async () => {
        if (!audioBlob || !currentActiveGroupId) return;

        const formData = new FormData();
        formData.append("file", audioBlob, "voice_message.webm"); // Provide a filename

        plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        plusOptionsBtn.disabled = true;
        closeModal("voice-recorder-modal");

        try {
          const res = await fetch(
            `${API_BASE_URL}/api/upload?uploadType=media`,
            {
              // Pass uploadType
              method: "POST",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
              },
              body: formData,
            },
          );
          const data = await res.json();
          if (data.success) {
            socket.emit("send-message", {
              groupId,
              type: "audio",
              file_url: data.file_url,
            }); // Force type 'audio'
          } else showAlert(data.error || "Upload failed");
        } catch (err) {
          showAlert("Error uploading voice message: " + err.message);
        } finally {
          plusOptionsBtn.innerHTML = '<i class="fas fa-plus"></i>';
          plusOptionsBtn.disabled = false;
          audioChunks = [];
          audioBlob = null;
          if (audioPreview.src) URL.revokeObjectURL(audioPreview.src);
        }
      };
    } catch (err) {
      showAlert("Failed to load chat: " + err.message);
    }
  };

  window.showCallHistory = async (groupId) => {
    try {
      const calls = await apiCall(`/api/groups/${groupId}/calls`);

      // Remove existing if refreshing
      document.querySelectorAll(".ch-overlay").forEach((el) => el.remove());

      const modal = document.createElement("div");
      modal.className = "modal-overlay ch-overlay";
      modal.style.zIndex = "10005";

      const formatDuration = (s) => {
        if (!s) return "0s";
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      };

      modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; width: 90%; padding: 1.5rem;">
            <h3 style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-history"></i> Group Call Logs
            </h3>
            <div style="max-height: 450px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;">
                ${
                  calls.length === 0
                    ? '<p style="text-align:center; padding: 30px; color: var(--text-muted);">No call logs available for this group.</p>'
                    : calls
                        .map(
                          (c) => `
                    <div style="padding: 15px; border-bottom: 1px solid var(--border); background: var(--bg-card);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-weight: 700; color: var(--primary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px;">
                                ${c.type} Call
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">
                                ${new Date(c.start_time).toLocaleString()}
                            </span>
                        </div>
                        <div style="font-size: 0.85rem; margin-bottom: 8px; line-height: 1.4;">
                            <strong style="color: var(--text-muted);">Participants:</strong><br>
                            ${c.participant_names}
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; font-size: 0.8rem; color: #28a745; font-weight: 600;">
                            <i class="fas fa-stopwatch"></i> Duration: ${formatDuration(c.duration_seconds)}
                        </div>
                    </div>
                  `,
                        )
                        .join("")
                }
            </div>
            <div style="margin-top: 1.5rem; text-align: right;">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">Close</button>
            </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.style.display = "flex";
    } catch (err) {
      showAlert("Failed to load call history: " + err.message);
    }
  };
  // WebRTC Logic ported from home.js
  window.startAudioCall = async (
    type,
    groupId,
    isJoining = false,
    targetUserId = null,
  ) => {
    if (currentCall) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (!isJoining) {
        currentCall = {
          type,
          groupId,
          callerId: user.id,
          participants: [user.id],
        };
        showCallUI();
        socket.emit("start-call", {
          type,
          groupId,
          targetUserId,
          fromName: user.name,
        });
      }
    } catch (err) {
      showAlert("Microphone access denied or not found.");
    }
  };

  async function createPeerConnection(remoteUserId, isInitiator, groupId) {
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[remoteUserId] = pc;

    if (!localStream) return;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc-signal", {
          to: remoteUserId,
          signal: { candidate: event.candidate },
          groupId,
        });
      }
    };

    pc.ontrack = (event) => {
      let audioTag = document.getElementById(`audio-${remoteUserId}`);
      if (!audioTag) {
        audioTag = document.createElement("audio");
        audioTag.id = `audio-${remoteUserId}`;
        audioTag.autoplay = true;
        audioTag.muted = false;
        const container = document.getElementById("remote-audios");
        if (container) container.appendChild(audioTag);
      }
      audioTag.srcObject = event.streams[0];
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc-signal", {
        to: remoteUserId,
        signal: offer,
        groupId,
      });
    }
    return pc;
  }

  function showCallUI() {
    let ui = document.getElementById("call-overlay");
    if (!ui) {
      ui = document.createElement("div");
      ui.id = "call-overlay";
      ui.style.cssText =
        "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:15px 20px; border-radius:12px; z-index:10002; box-shadow:0 4px 15px rgba(0,0,0,0.5); display:flex; flex-direction:column; align-items:center; gap:10px;";
      document.body.appendChild(ui);
    }
    ui.innerHTML = `
        <div style="text-align:center;">
            <h4 style="margin-bottom:5px;">Ongoing ${currentCall && currentCall.type === "private" ? "Personal" : "Group"} Call</h4>
            <audio id="local-audio" autoplay muted style="display:none;"></audio>
            <div id="remote-audios" style="display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; justify-content:center;"></div>
            <div style="display:flex; gap:15px; margin-top:15px; justify-content:center;">
                <button id="mute-btn" class="icon-btn" style="background:rgba(255,255,255,0.2); border:none; color:white; padding:10px; border-radius:50%; width:45px; height:45px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-microphone"></i></button>
                <button id="leave-call-btn" class="icon-btn" style="background:#dc3545; border:none; color:white; padding:10px; border-radius:50%; width:45px; height:45px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-phone-slash"></i></button>
            </div>
        </div>
    `;
    ui.style.display = "flex";
    const localAudio = document.getElementById("local-audio");
    if (localAudio && localStream) localAudio.srcObject = localStream;

    document.getElementById("mute-btn").onclick = window.toggleMute;
    document.getElementById("leave-call-btn").onclick = window.endCall;
  }

  function showIncomingCallModal(data) {
    let modal = document.getElementById("incoming-call-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "incoming-call-modal";
      modal.className = "modal-overlay";
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="modal-content" style="width: 300px; padding: 1.5rem; text-align: center;">
            <h3>Incoming Call</h3>
            <p style="margin: 1rem 0;">From: <strong>${data.callerName || data.fromName}</strong></p>
            <div style="display: flex; justify-content: center; gap: 1rem;">
                <button id="accept-call-btn" class="btn-submit" style="background: #28a745;"><i class="fas fa-phone"></i> Accept</button>
                <button id="reject-call-btn" class="btn-cancel" style="background: #dc3545; color:white;"><i class="fas fa-phone-slash"></i> Reject</button>
            </div>
        </div>
    `;
    modal.style.display = "flex";
    document.getElementById("accept-call-btn").onclick = async () => {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      pendingCall = null;
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Set currentCall immediately so endCall() works even before signaling is complete
      currentCall = data;
      showCallUI();
      socket.emit("accept-call", {
        callId: data.callId,
        groupId: data.groupId,
      });
    };
    document.getElementById("reject-call-btn").onclick = () => {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      pendingCall = null;
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "user_rejected",
      });
    };
  }

  function hideIncomingCallModal() {
    const m = document.getElementById("incoming-call-modal");
    if (m) m.style.display = "none";
  }

  window.toggleMute = () => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    document.getElementById("mute-btn").innerHTML = isMuted
      ? '<i class="fas fa-microphone-slash"></i>'
      : '<i class="fas fa-microphone"></i>';
  };

  window.endCall = () => {
    if (!currentCall) return;
    socket.emit("end-call", {
      callId: currentCall.callId,
      groupId: currentCall.groupId,
    });
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    for (let id in peerConnections) {
      peerConnections[id].close();
      const el = document.getElementById(`audio-${id}`);
      if (el) el.remove();
    }
    peerConnections = {};
    currentCall = null;
    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.remove();
  };

  window.addMember = async (groupId) => {
    const userId = document.getElementById("add-member-select").value;
    if (!userId) return;
    try {
      await apiCall(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      window.renderGroupDetail(groupId);
    } catch (err) {
      showAlert("Error adding member: " + err.message);
    }
  };

  window.removeMember = async (groupId, userId) => {
    if (!(await showAlert("Remove this user from the group?"))) return;
    try {
      await apiCall(`/api/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
      });
      window.renderGroupDetail(groupId);
    } catch (err) {
      showAlert("Error removing member: " + err.message);
    }
  };

  async function initGroupModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "add-group-modal";
    modal.innerHTML = `
            <div class="modal-content">
                <h3>Create New Group</h3>
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">Select users to add.</p>
                <div class="form-field">
                    <label>Group Name</label>
                    <input type="text" id="group-name-input" placeholder="e.g. Engineering Team">
                </div>
                <div class="form-field">
                    <label>Select Members</label>
                    <div class="user-select-list" id="user-selection-list"></div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeModal('add-group-modal')">Cancel</button>
                    <button class="btn-submit" id="create-group-btn">Create Group</button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
    document.getElementById("create-group-btn").onclick = createNewGroup;
  }

  async function initEditModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "edit-user-modal";
    modal.innerHTML = `
            <div class="modal-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3>Edit User Account</h3>
                    <button class="btn-cancel" style="background: #ff4d4d; color: white; padding: 5px 10px;" id="delete-user-btn">Delete Account</button>
                </div>
                <input type="hidden" id="edit-user-id">
                <div class="form-field">
                    <label>Full Name</label>
                    <input type="text" id="edit-name">
                </div>
                <div class="form-field">
                    <label>Account Type</label>
                    <select id="edit-role">
                        <option value="user">User</option>
                        <option value="developer">Developer</option>
                    </select>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeModal('edit-user-modal')">Cancel</button>
                    <button class="btn-submit" id="save-edit-btn">Save Changes</button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
    document.getElementById("save-edit-btn").onclick = handleUpdateUser;
    document.getElementById("delete-user-btn").onclick = handleDeleteUser;
  }

  window.openEditModal = (id) => {
    const target = users.find((u) => u.id === id);
    if (!target) return;

    document.getElementById("edit-user-id").value = target.id;
    document.getElementById("edit-name").value = target.name;
    document.getElementById("edit-role").value = target.role;
    document.getElementById("edit-user-modal").style.display = "flex";
  };

  async function handleUpdateUser() {
    const id = document.getElementById("edit-user-id").value;
    const name = document.getElementById("edit-name").value.trim();
    const role = document.getElementById("edit-role").value;

    if (!name) return showAlert("Name cannot be empty");

    try {
      await apiCall(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, role }),
      });
      await loadUsers();
      renderUsers();
      closeModal("edit-user-modal");
      showToast("User updated successfully");
    } catch (err) {
      showAlert("Update failed: " + err.message);
    }
  }

  async function handleDeleteUser() {
    const id = document.getElementById("edit-user-id").value;
    if (
      !(await showAlert(
        `Are you sure you want to permanently delete user ${id}?`,
      ))
    )
      return;

    try {
      await apiCall(`/api/admin/users/${id}`, { method: "DELETE" });
      await loadUsers();
      renderUsers();
      closeModal("edit-user-modal");
      showToast("User deleted");
    } catch (err) {
      showAlert("Delete failed: " + err.message);
    }
  }

  async function initModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "add-user-modal";
    modal.innerHTML = `
            <div class="modal-content">
                <h3>Create New Account</h3>
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">Unique ID auto-generated.</p>
                <div class="form-field">
                    <label>Full Name</label>
                    <input type="text" id="new-name" placeholder="e.g. John Doe">
                </div>
                <div class="form-field">
                    <label>Password</label>
                    <input type="password" id="new-pass" placeholder="Min 6 chars">
                </div>
                <div class="form-field">
                    <label>Account Type</label>
                    <select id="new-role">
                        <option value="user" selected>User</option>
                        <option value="developer">Developer</option>
                    </select>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeModal('add-user-modal')">Cancel</button>
                    <button class="btn-submit" id="create-btn">Create Account</button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
    document.getElementById("create-btn").onclick = createNewUser;
  }

  window.closeModal = (id) =>
    (document.getElementById(id).style.display = "none");

  async function createNewUser() {
    const name = document.getElementById("new-name").value.trim();
    const pass = document.getElementById("new-pass").value;
    const role = document.getElementById("new-role").value || "user";

    if (!name || !pass) return showAlert("Fill all fields");

    try {
      const newUser = await apiCall("/api/admin/users/create", {
        method: "POST",
        body: JSON.stringify({ name, password: pass, role }),
      });
      users.unshift(newUser);
      renderUsers();
      closeModal("add-user-modal");
      document.getElementById("new-name").value = "";
      document.getElementById("new-pass").value = "";
      showToast(`User ${newUser.id} created!`);
    } catch (err) {
      showAlert("Create failed: " + err.message);
    }
  }

  async function createNewGroup() {
    const name = document.getElementById("group-name-input").value.trim();
    const memberIds = Array.from(
      document.querySelectorAll("#user-selection-list input:checked"),
    ).map((cb) => cb.value);

    if (!name || memberIds.length === 0)
      return showAlert("Name and members required");

    try {
      const newGroup = await apiCall("/api/admin/groups", {
        method: "POST",
        body: JSON.stringify({ name, memberIds }),
      });
      await loadGroups();
      renderGroups();
      closeModal("add-group-modal");
      document.getElementById("group-name-input").value = "";
      showToast(`Group "${newGroup.name}" created!`);
    } catch (err) {
      showAlert("Create failed: " + err.message);
    }
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.style.cssText =
      "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:var(--primary, #333);color:white;padding:12px 24px;border-radius:8px;z-index:10001;box-shadow:0 5px 15px rgba(0,0,0,0.3);font-family:sans-serif;pointer-events:none;transition:opacity 0.3s;opacity:1;";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 1000);
  }

  function showAlert(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
      const box = document.createElement("div");
      box.style.cssText =
        "background:var(--bg-card, white);color:var(--text-main, #333);padding:1.5rem;border-radius:12px;text-align:center;min-width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.2);border:1px solid var(--border, #eee);";
      box.innerHTML = `
            <p style="margin-bottom:1.5rem;font-size:1rem;font-weight:500;">${message}</p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button id="alert-cancel" style="background:#6c757d;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Cancel</button>
                <button id="alert-confirm" style="background:var(--primary, #007bff);color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Confirm</button>
            </div>
        `;
      box.querySelector("#alert-cancel").onclick = () => {
        overlay.remove();
        resolve(false);
      };
      box.querySelector("#alert-confirm").onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  window.renderSection = async (id) => {
    navItems.forEach((item) =>
      item.classList.toggle("active", item.dataset.section === id),
    );
    if (id === "dashboard") {
      try {
        // Ensure currentActiveGroupId is reset when navigating away from a chat
        if (currentActiveGroupId) {
          socket.emit("leave-group", currentActiveGroupId);
          currentActiveGroupId = null;
        }
        await Promise.all([loadUsers(), loadGroups()]);
        contentArea.innerHTML = await sections.dashboard();
      } catch (err) {
        contentArea.innerHTML = `<div class="section-fade"><h2 style="color:red;">Error loading dashboard</h2><p>${err.message}</p></div>`;
      }
      return;
    }
    contentArea.innerHTML =
      // Ensure currentActiveGroupId is reset when navigating away from a chat
      id !== "groups" && currentActiveGroupId
        ? (socket.emit("leave-group", currentActiveGroupId),
          (currentActiveGroupId = null),
          sections[id])
        : // If navigating to groups, ensure currentActiveGroupId is reset
          id === "groups" && currentActiveGroupId
          ? (socket.emit("leave-group", currentActiveGroupId),
            (currentActiveGroupId = null),
            sections[id])
          : // Default behavior
            sections[id] ||
            `<h1>${id.charAt(0).toUpperCase() + id.slice(1)}</h1>`;

    if (id === "users") {
      await loadUsers();
      renderUsers();
      document.getElementById("open-modal-btn").onclick = () =>
        (document.getElementById("add-user-modal").style.display = "flex");
    }
    if (id === "groups") {
      await Promise.all([loadGroups(), loadUsers()]);
      renderGroups();
      document.getElementById("open-group-modal-btn").onclick = async () => {
        const list = document.getElementById("user-selection-list");
        list.innerHTML = users
          .map(
            (u) => `
                    <label class="user-select-item">
                        <input type="checkbox" value="${u.id}">
                        <span>${u.name} (${u.role})</span>
                    </label>
                `,
          )
          .join("");
        document.getElementById("add-group-modal").style.display = "flex";
      };
    }
    navItems.forEach((item) =>
      item.classList.toggle("active", item.dataset.section === id),
    );
  };

  navItems.forEach((item) =>
    item.addEventListener("click", () => {
      window.renderSection(item.dataset.section);
      dashboardContainer.classList.remove("sidebar-open");
    }),
  );

  // Initial load
  await initModal();
  await initGroupModal();
  await initEditModal();
  await window.renderSection("dashboard");
});
