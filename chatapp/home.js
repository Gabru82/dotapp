document.addEventListener("DOMContentLoaded", async () => {
  const user = JSON.parse(localStorage.getItem("chat_user") || "{}");
  const token = localStorage.getItem("chat_token");

  // Redirect if session is missing
  if (!token || !user.id) {
    window.location.href = "/chatapp/login.html"; // Ensure correct path
    return;
  }

  // Initialize Socket.io Connection
  const socket = io("https://dotapp.onrender.com", {
    auth: { token: token },
  });

  // WebRTC State
  let localStream = null; // User's local audio stream
  let peerConnections = {}; // Map: remoteUserId -> RTCPeerConnection
  let isMuted = false; // Local mute state
  let activeGroupsData = []; // Store group metadata including features
  let currentCall = null; // { callId, type, groupId, callerId, participants: string[] }
  let pendingCall = null; // Tracks an incoming call before it's accepted
  let incomingCallTimeout = null;
  let mediaRecorder; // For voice messages
  let audioChunks = [];
  let audioBlob;

  let notifications = [];
  const iceServers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  // UI Helper: Toast for auto-hiding informative messages
  function showToast(message) {
    const toast = document.createElement("div");
    toast.style.cssText =
      "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 24px;border-radius:8px;z-index:10001;box-shadow:0 5px 15px rgba(0,0,0,0.3);font-family:sans-serif;pointer-events:none;transition:opacity 0.3s;opacity:1;";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // UI Helper: Popup for Confirm and Cancel decisions
  function showAlert(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
      const box = document.createElement("div");
      box.style.cssText =
        "background:var(--bg-card, white);color:var(--text-main, #333);padding:1.5rem;border-radius:12px;text-align:center;min-width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.2);border:1px solid var(--border, #eee);font-family:sans-serif;";
      box.innerHTML = `
            <p style="margin-bottom:1.5rem;font-size:1rem;font-weight:500;line-height:1.4;">${message}</p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button id="alert-cancel" style="background:#6c757d;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Cancel</button>
                <button id="alert-confirm" style="background:var(--primary, #007bff);color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Confirm</button>
            </div>
        `;
      box.querySelector("#alert-cancel").onclick = () => { overlay.remove(); resolve(false); };
      box.querySelector("#alert-confirm").onclick = () => { overlay.remove(); resolve(true); };
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  // Function to fetch user's groups and populate activeGroupsData
  async function fetchAndRenderMyGroups() {
    try {
      const response = await fetch("/api/my-groups", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch groups");
      }
      activeGroupsData = await response.json();
      renderGroupList(activeGroupsData); // Render the sidebar group list
      console.log("Fetched active groups:", activeGroupsData);
    } catch (error) {
      console.error("Error fetching my groups:", error);
      // Optionally, show a toast or alert to the user
    }
  }

  // Render the group list in the home screen
  function renderGroupList(groups) {
    const groupListElement = document.getElementById("group-list");
    if (groupListElement) {
      groupListElement.innerHTML = groups
        .map(
          (group) => `
                <li onclick="window.joinChatGroup('${group.id}')" class="group-item" style="display: flex; align-items: center; gap: 15px; padding: 15px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.2s;">
                    <div class="group-logo" style="width: 48px; height: 48px; background: var(--primary); color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                        <i class="fas fa-layer-group"></i>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; color: var(--text-main); font-size: 1.1rem; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${group.name}</div>
                        <div style="display: flex; gap: 12px; font-size: 0.75rem; color: var(--text-muted); align-items: center;">
                            <span><i class="fas fa-users" style="margin-right: 4px;"></i>${group.member_count || 0} Members</span>
                            <span><i class="fas fa-crown" style="margin-right: 4px;"></i>By: ${group.created_by}</span>
                        </div>
                    </div>
                    <i class="fas fa-chevron-right" style="color: var(--border); font-size: 0.8rem;"></i>
                </li>
            `,
        )
        .join("");
    }
  }

  // Call this function when the page loads to populate activeGroupsData
  await fetchAndRenderMyGroups(); // Await this call

  // Setup Notification Bell in Header
  function setupNotificationUI() {
    const header = document.querySelector('.home-header') || document.querySelector('.header');
    if (!header) return;

    const notifContainer = document.createElement('div');
    notifContainer.id = 'notif-bell-wrapper';
    notifContainer.style.cssText = "position:relative; cursor:pointer; margin-left: auto; margin-right: 15px; display: flex; align-items: center;";
    notifContainer.innerHTML = `
      <i class="fas fa-bell" style="font-size: 1.4rem; color: var(--text-main);"></i>
      <span id="notif-badge" style="display:none; position:absolute; top:-5px; right:-5px; background:#ff4d4d; color:white; border-radius:50%; padding:2px 6px; font-size:10px; font-weight:bold; border: 2px solid var(--bg-body);">0</span>
      <div id="notif-dropdown" style="display:none; position:absolute; top:40px; right:0; width:280px; background:var(--bg-card, white); border:1px solid var(--border); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:10005; padding:12px; color:var(--text-main);">
          <div style="font-weight:bold; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>Notifications</span>
            <button id="clear-notifs" style="background:none; border:none; color:var(--primary); font-size:0.75rem; cursor:pointer;">Clear All</button>
          </div>
          <div id="notif-list" style="max-height:300px; overflow-y:auto; font-size:0.85rem; text-align:left;">
              <div style="color:var(--text-muted); text-align:center; padding:20px;">No new notifications</div>
          </div>
      </div>
    `;
    header.appendChild(notifContainer);

    const dropdown = document.getElementById('notif-dropdown');
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');

    notifContainer.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      badge.style.display = 'none';
      badge.innerText = '0';
    };

    document.getElementById('clear-notifs').onclick = (e) => {
      e.stopPropagation();
      notifications = [];
      list.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">No new notifications</div>';
    };

    document.addEventListener('click', () => { if(dropdown) dropdown.style.display = 'none'; });
  }

  function addNotification(text) {
    notifications.unshift({ text, time: new Date() });
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    
    if (list) {
      list.innerHTML = notifications.map(n => `
        <div style="padding:10px; border-bottom:1px solid var(--border); line-height:1.4;">
          ${n.text}
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">${n.time.toLocaleTimeString()}</div>
        </div>
      `).join('');
    }
    if (badge) {
      badge.innerText = notifications.length;
      badge.style.display = 'block';
    }
  }

  setupNotificationUI();

  // Real-time message listener
  socket.on("force-logout", () => {
    localStorage.removeItem("chat_token");
    localStorage.removeItem("chat_user");
    localStorage.removeItem("chat_isLoggedIn");
    window.location.href = "/chatapp/login.html";
  });

  socket.on("new-message", (msg) => {
    if (window.currentGroupId && msg.group_id == window.currentGroupId) {
      appendMessage(msg);
    }
  });

  // Added to group notification listener
  socket.on("added-to-group", (data) => {
    addNotification(`Admin added you in "${data.groupName}"`);
    showToast(`You were added to group: ${data.groupName}`);
  });

  // Removed from group notification listener
  socket.on("removed-from-group", (data) => {
    addNotification(`Admin removed you from "${data.groupName}"`);
    showToast(`You were removed from group: ${data.groupName}`);
  });

  // Socket.IO Call Events
  socket.on("incoming-call", (data) => {
    // If the incoming call is from ourselves (e.g., group call initiation), ignore it.
    if (data.callerId === user.id) {
      return;
    }
    if (currentCall) {
      // Already in a call, reject new incoming call
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "busy",
      });
      return;
    }

    // Close group members modal if it's open
    document.querySelectorAll(".gm-overlay").forEach((el) => el.remove());

    pendingCall = data;
    // Display incoming call modal
    showIncomingCallModal(data);
    incomingCallTimeout = setTimeout(() => {
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "no_answer",
      });
      hideIncomingCallModal();
      pendingCall = null;
      // alert("Missed call from " + data.fromName);
    }, 30000); // 30 seconds timeout
  });
  socket.on("call-log-updated", (data) => {
    if (
      window.currentGroupId == data.groupId &&
      document.querySelector(".ch-overlay")
    ) {
      // If the call history modal is open, refresh it
      window.openCallHistory(data.groupId);
    }
  });
  socket.on("call-accepted", async (data) => {
    console.log("Call accepted event received:", data);
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    pendingCall = null;

    const isNewCall = !currentCall || currentCall.callId !== data.callId;
    currentCall = data; // Always update to ensure participant list is fresh

    if (isNewCall) {
      showCallUI();
      const group = activeGroupsData.find((g) => g.id == data.groupId);
      if (group) {
        renderChatHeader(group, true);
      }
    }

    // Establish peer connections with all other participants in the call
    for (const participantId of data.participants) {
      if (participantId !== user.id && !peerConnections[participantId]) {
        // Deterministic initiation for full mesh: smaller ID initiates to larger ID.
        const isInitiator = user.id < participantId;
        console.log(`Establishing PC with ${participantId}, isInitiator: ${isInitiator}`);
        await createPeerConnection(participantId, isInitiator, data.groupId);
      }
    }
  });

  socket.on("webrtc-signal", async (data) => {
    // Ignore signals if we haven't accepted a call yet (localStream/currentCall not ready)
    if (!currentCall || !localStream) {
      return;
    }

    if (!peerConnections[data.from]) {
      console.log(`Creating PC for ${data.from} due to incoming signal`);
      await createPeerConnection(data.from, false, data.groupId);
    }

    const pc = peerConnections[data.from];
    if (!pc) return;

    try {
      // Handle SDP (offer/answer)
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
      }
      // Handle ICE candidate
      else if (data.signal.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      } else {
        console.warn("Unknown WebRTC signal:", data.signal);
      }
    } catch (error) {
      console.error("WebRTC signal error:", error);
    }
  });

  socket.on("participant-left", (data) => {
    console.log(`Participant left: ${data.userId}`);
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

  socket.on("call-ended", (data) => {
    if (currentCall && currentCall.callId === data.callId) {
      console.log("Call ended by server");
      window.endCall();
    }
    // Cancel incoming call if the caller hung up before we answered
    if (pendingCall && pendingCall.callId === data.callId) {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      pendingCall = null;
    }
  });

  socket.on("call-rejected", (data) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    // If it was a private call, end the call session for the caller.
    // For group calls, do not end the session as other participants might still join.
    if (currentCall && currentCall.type === "private") {
      endCall();
    }
  });

  socket.on("call-missed", (data) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    // alert(`Call was missed.`); // More generic message as targetName is not always available
    if (currentCall && currentCall.callerId === user.id) {
      endCall(); // Clean up if we were the caller
    }
  });

  socket.on("call-error", (msg) => {
    clearTimeout(incomingCallTimeout);
    hideIncomingCallModal();
    // alert(msg);
  });

  // Join a specific group's real-time room
  window.joinChatGroup = (groupId) => {
    window.currentGroupId = groupId;
    socket.emit("join-group", groupId);
    console.log(`Joined real-time room for group: ${groupId}`);

    const chatBox = document.getElementById("chatBody");
    if (chatBox) chatBox.innerHTML = ""; // Clear chat UI

    // Find the group and render its header
    const group = activeGroupsData.find((g) => g.id == groupId);
    if (group) {
      renderChatHeader(group);
    } else {
      console.warn(`Group with ID ${groupId} not found in activeGroupsData.`);
    }
    loadMessages(groupId); // Load messages when joining a group
    setupChatInputListeners(groupId); // Setup new listeners
    document.getElementById("homeScreen").style.display = "none";
    document.getElementById("chatScreen").style.display = "flex";
  };

  // New function to setup chat input listeners
  function setupChatInputListeners(groupId) {
    const plusOptionsBtn = document.getElementById("plusBtn");
    const fileOptionsModal = document.getElementById("file-options-modal");
    const sendMediaBtn = document.getElementById("send-media-btn");
    const sendDocumentBtn = document.getElementById("send-document-btn");
    const recordVoiceBtn = document.getElementById("record-voice-btn");
    const mediaInput = document.getElementById("mediaInput");
    const documentInput = document.getElementById("documentInput");

    const voiceRecorderModal = document.getElementById("voice-recorder-modal");
    const recordingStatus = document.getElementById("recording-status");
    const stopRecordingBtn = document.getElementById("stop-recording-btn");
    const sendRecordingBtn = document.getElementById("send-recording-btn");
    const audioPreview = document.getElementById("audio-preview");

    // Plus button to open options modal
    plusOptionsBtn.onclick = () => {
      fileOptionsModal.style.display = "flex";
    };

    // Option handlers
    sendMediaBtn.onclick = () => {
      mediaInput.click();
      fileOptionsModal.style.display = "none";
    };
    sendDocumentBtn.onclick = () => {
      documentInput.click();
      fileOptionsModal.style.display = "none";
    };
    recordVoiceBtn.onclick = async () => {
      fileOptionsModal.style.display = "none";
      await startRecording();
    };

    // Media Input Change (image/video/audio)
    mediaInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024)
        return showToast("File size exceeds 10MB limit");

      const formData = new FormData();
      formData.append("file", file);

      plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      plusOptionsBtn.disabled = true;

      try {
        const res = await fetch(`/api/upload?uploadType=media`, {
            // Pass uploadType
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
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
        } else showToast(data.error || "Upload failed");
      } catch (err) {
        showToast("Error uploading media file");
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
        return showToast("File size exceeds 10MB limit");

      const formData = new FormData();
      formData.append("file", file);

      plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      plusOptionsBtn.disabled = true;

      try {
        const res = await fetch(`/api/upload?uploadType=document`, {
            // Pass uploadType
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
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
        } else showToast(data.error || "Upload failed");
      } catch (err) {
        showToast("Error uploading document file");
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
          showToast("Could not start recording: " + err.message);
        voiceRecorderModal.style.display = "none";
      }
    }

    window.stopRecording = (cancel = false) => {
      // Make it global for HTML onclick
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      if (cancel) {
        voiceRecorderModal.style.display = "none";
        if (audioPreview.src) URL.revokeObjectURL(audioPreview.src);
        audioChunks = [];
        audioBlob = null;
      }
    };

    stopRecordingBtn.onclick = () => window.stopRecording(false);

    sendRecordingBtn.onclick = async () => {
      if (!audioBlob || !groupId) return;

      const formData = new FormData();
      formData.append("file", audioBlob, "voice_message.webm"); // Provide a filename

      plusOptionsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      plusOptionsBtn.disabled = true;
      voiceRecorderModal.style.display = "none";

      try {
        const res = await fetch(`/api/upload?uploadType=media`, {
            // Pass uploadType
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
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
          } else showToast(data.error || "Upload failed");
      } catch (err) {
          showToast("Error uploading voice message: " + err.message);
      } finally {
        plusOptionsBtn.innerHTML = '<i class="fas fa-plus"></i>';
        plusOptionsBtn.disabled = false;
        audioChunks = [];
        audioBlob = null;
        if (audioPreview.src) URL.revokeObjectURL(audioPreview.src);
      }
    };
  }

  window.closeChat = () => {
    document.getElementById("chatScreen").style.display = "none";
    document.getElementById("homeScreen").style.display = "flex";
    window.currentGroupId = null;
  };

  function renderChatHeader(group, inCall = false) {
    const header = document.getElementById("chat-header");
    if (!header) return;

    header.innerHTML = `
            <div class="back-btn" onclick="window.closeChat()" style="cursor:pointer; width:36px; display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-chevron-left"></i>
            </div>
            <div class="chat-title" onclick="window.openMembersModal('${group.id}')" style="cursor:pointer; flex: 1; text-align: center; font-weight: 700; color: var(--text-main); font-size: 16px;">
                ${group.name} <i class="fas fa-info-circle" style="font-size:0.8rem; color: var(--text-muted);"></i>
            </div>
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 5px;">
                ${
                  group.group_call_enabled && !inCall
                    ? `<button onclick="window.startAudioCall('group', '${group.id}')" style="background:none; border:none; color:var(--primary); cursor:pointer; font-size: 1.1rem; padding: 5px;"><i class="fas fa-phone"></i></button>`
                    : ""
                }
                <button onclick="window.openCallHistory('${group.id}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size: 1.1rem; padding: 5px;"><i class="fas fa-ellipsis-v"></i></button>
            </div>
        `;
  }

  window.openCallHistory = async (groupId) => {
    try {
      const response = await fetch(`/api/groups/${groupId}/calls`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const calls = await response.json();

      // Remove existing if refreshing
      document.querySelectorAll(".ch-overlay").forEach((el) => el.remove());

      const modal = document.createElement("div");
      modal.className = "gm-overlay ch-overlay";
      modal.style.zIndex = "10001";

      const formatDuration = (s) => {
        if (!s) return "0s";
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      };

      modal.innerHTML = `
        <div class="gm-card" style="max-width: 450px; width: 90%;">
            <h3 class="gm-title">📞 Call History</h3>
            <div class="gm-list" style="max-height: 400px; overflow-y: auto;">
                ${
                  calls.length === 0
                    ? '<p style="text-align:center; padding: 20px; color: var(--text-muted);">No call logs found.</p>'
                    : calls
                        .map(
                          (c) => `
                    <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 700; color: var(--primary); font-size: 0.9rem;">
                                <i class="fas ${c.type === "group" ? "fa-users" : "fa-user"}"></i> 
                                ${c.type.toUpperCase()} CALL
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">
                                ${new Date(c.start_time).toLocaleString()}
                            </span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-main);">
                            <strong>Joined:</strong> ${c.participant_names}
                        </div>
                        <div style="font-size: 0.8rem; color: #28a745;">
                            <i class="fas fa-clock"></i> Duration: ${formatDuration(c.duration_seconds)}
                        </div>
                    </div>
                  `,
                        )
                        .join("")
                }
            </div>
            <button class="gm-close-btn" onclick="this.closest('.gm-overlay').remove()">✖ Close</button>
        </div>
      `;
      document.body.appendChild(modal);
    } catch (err) {
      console.error(err);
    }
  };

  socket.on("group-settings-updated", (data) => {
    const group = activeGroupsData.find((g) => g.id == data.id);
    if (group) {
      if (data.group_call_enabled !== undefined)
        group.group_call_enabled = data.group_call_enabled;
      if (data.personal_call_enabled !== undefined)
        group.personal_call_enabled = data.personal_call_enabled;

      // Refresh UI if the user is currently viewing this group
      if (window.currentGroupId == data.id) {
        renderChatHeader(group);
      }
    }
  });

  // Real-time group list updates
  socket.on("groups-updated", (data) => {
    console.log("Group list update received");
    fetchAndRenderMyGroups();

    // If the currently active group was deleted or the user was removed, kick to home screen
    if (data && (data.deleted || data.removed) && window.currentGroupId == data.groupId) {
      window.closeChat();
    }
  });

  window.openMembersModal = async (groupId) => {
    try {
      const group = activeGroupsData.find((g) => g.id == groupId);
      if (!group) {
        console.warn(
          `Group with ID ${groupId} not found in activeGroupsData for modal.`,
        );
        return;
      }
      const response = await fetch(`/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const members = await response.json();

      const modal = document.createElement("div");
      modal.className = "gm-overlay";

      modal.innerHTML = `
    <div class="gm-card">
        <h3 class="gm-title">👥 Group Members</h3>

        <div class="gm-list">
            ${members
              .map(
                (m) => `
                <div class="gm-item">
                    <div class="gm-user">
                        <strong class="gm-name">${m.name}</strong>
                        <span class="gm-role">${m.role}</span>
                    </div>

                    ${
                      group.personal_call_enabled &&
                      m.id !== user.id &&
                      !currentCall
                        ? `<button class="gm-call-btn" onclick="window.startAudioCall('private', '${groupId}', false, '${m.id}')">
                            📞 Call
                        </button>`
                        : ""
                    }
                </div>
            `,
              )
              .join("")}
        </div>

        <button class="gm-close-btn" onclick="this.closest('.gm-overlay').remove()">
            ✖ Close
        </button>
    </div>
`;
      document.body.appendChild(modal);
    } catch (err) {
      console.error(err);
    }
  };

  window.startAudioCall = async (
    type,
    groupId,
    isJoining = false,
    targetUserId = null,
  ) => {
    if (currentCall) {
      // alert("You are already in a call.");
      return;
    }

    // Close group members modal if it's open
    document.querySelectorAll(".gm-overlay").forEach((el) => el.remove());

    try {
      // Request local audio stream with advanced constraints for better quality
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      // Show local stream in a hidden audio element for self-monitoring
      const localAudio = document.getElementById("local-audio");
      if (localAudio) localAudio.srcObject = localStream; // Assign stream to hidden audio for local playback

      // Emit start-call event to server
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
        // alert("Calling..."); // Indicate call is being initiated
      }
    } catch (err) {
      showToast("Microphone access denied or not found.");
      console.error("Error starting call:", err);
    }
  };

  // This function is now primarily called by `call-accepted` to establish connections
  // It ensures full mesh by creating PCs with all other participants
  async function setupCall(callData) {
    // callData is the data received from 'call-accepted'
    if (!localStream) {
      console.error("Local stream not available for setupCall.");
      return;
    }

    // Establish peer connections with all other participants
    for (const participantId of callData.participants) {
      // callData.participants is an array of user IDs
      if (participantId !== user.id) {
        await createPeerConnection(participantId, true, callData.groupId);
      }
    }
  }

  async function createPeerConnection(remoteUserId, isInitiator, groupId) {
    const pc = new RTCPeerConnection(iceServers);
    console.log(`Creating RTCPeerConnection for remote user: ${remoteUserId}`);
    peerConnections[remoteUserId] = pc;

    if (!localStream)
      return console.error("Local stream not available for PC creation.");

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
      console.log(`Received remote track from ${remoteUserId}`);
      let audioTag = document.getElementById(`audio-${remoteUserId}`);
      if (!audioTag) {
        audioTag = document.createElement("audio");
        audioTag.id = `audio-${remoteUserId}`;
        audioTag.autoplay = true;
        audioTag.playsinline = true; // Important for iOS
        audioTag.muted = false; // Ensure it's not muted by default
        document.getElementById("remote-audios").appendChild(audioTag);
      }
      // Attach the remote stream to the audio element
      audioTag.srcObject = event.streams[0];
      // Attempt to play to bypass autoplay restrictions, might require user interaction
      audioTag.play().catch((e) => {
        console.warn(`Autoplay prevented for ${remoteUserId}:`, e);
      });
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

    pc.oniceconnectionstatechange = () => {
      console.log(
        `ICE connection state for ${remoteUserId}: ${pc.iceConnectionState}`,
      );
    };
    pc.onsignalingstatechange = () => {
      console.log(`Signaling state for ${remoteUserId}: ${pc.signalingState}`);
    };

    return pc;
  }

  function showCallUI() {
    let ui = document.getElementById("call-overlay");
    if (!ui) {
      ui = document.createElement("div");
      ui.id = "call-overlay";
      ui.style.cssText =
        "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:15px 20px; border-radius:12px; z-index:10000; box-shadow:0 4px 15px rgba(0,0,0,0.5); display:flex; flex-direction:column; align-items:center; gap:10px;";
      document.body.appendChild(ui);
    }
    ui.innerHTML = `
            <div style="text-align:center;">
                <h4>Ongoing ${currentCall && currentCall.type === "private" ? "Personal" : "Group"} Call</h4>
                <audio id="local-audio" autoplay muted style="display:none;"></audio>
                <div id="remote-audios" style="display:flex; flex-wrap:wrap; gap:5px; margin-top:10px;"></div>
                <div style="display:flex; gap:15px; margin-top:15px; justify-content:center;">
                    <button id="mute-btn" style="background:rgba(255,255,255,0.2); border:none; color:white; padding:10px; border-radius:50%; width:45px; height:45px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-microphone"></i></button>
                    <button id="leave-call-btn" style="background:#dc3545; border:none; color:white; padding:10px; border-radius:50%; width:45px; height:45px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-phone-slash"></i></button>
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
      modal.className = "modal-overlay"; // Re-use existing modal-overlay styles
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
            <div class="modal-content" style="width: 300px; padding: 1.5rem; text-align: center;">
                <h3 style="margin-bottom: 1rem;">Incoming ${data.type === "group" ? "Group" : "Personal"} Call</h3>
                <p style="margin-bottom: 1.5rem;">From: <strong>${data.callerName || data.fromName}</strong></p>
                <div style="display: flex; justify-content: center; gap: 1rem; flex-wrap: wrap;">
                    <button id="accept-call-btn" class="btn-save" style="background: #28a745;"><i class="fas fa-phone"></i> Accept</button>
                    <button id="reject-call-btn" class="btn-logout" style="background: #dc3545;"><i class="fas fa-phone-slash"></i> Reject</button>
                </div>
            </div>
        `;
    modal.style.display = "flex";

    document.getElementById("accept-call-btn").onclick = async () => {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      try {
        // Request local audio stream with advanced constraints for better quality
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        const localAudio = document.getElementById("local-audio");
        if (localAudio) localAudio.srcObject = localStream;

        // Set currentCall immediately so the "Leave" button functions if clicked right away
        pendingCall = null;
        currentCall = data;
        
        showCallUI();
        const group = activeGroupsData.find((g) => g.id == data.groupId);
        if (group) renderChatHeader(group, true);

        socket.emit("accept-call", {
          callId: data.callId,
          groupId: data.groupId,
        }); // Server will then broadcast 'call-accepted' to all participants
      } catch (err) {
        showToast("Microphone access denied or not found. Cannot accept call.");
        console.error("Error accepting call:", err);
        socket.emit("reject-call", {
          callId: data.callId,
          groupId: data.groupId,
          reason: "mic_error",
        });
      }
    };
    document.getElementById("reject-call-btn").onclick = () => {
      clearTimeout(incomingCallTimeout);
      hideIncomingCallModal();
      socket.emit("reject-call", {
        callId: data.callId,
        groupId: data.groupId,
        reason: "user_rejected",
      });
    };
  }

  function hideIncomingCallModal() {
    const modal = document.getElementById("incoming-call-modal");
    if (modal) modal.style.display = "none";
  }

  window.toggleMute = () => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    document.getElementById("mute-btn").innerHTML = isMuted
      ? '<i class="fas fa-microphone-slash"></i>'
      : '<i class="fas fa-microphone"></i>';
  };

  window.endCall = () => {
    console.log("Ending call...");
    if (!currentCall) return;

    socket.emit("end-call", {
      callId: currentCall.callId,
      groupId: currentCall.groupId,
    });

    // Stop all local media tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }

    // Close all peer connections and remove remote audio elements
    for (const remoteUserId in peerConnections) {
      peerConnections[remoteUserId].close();
      const remoteAudio = document.getElementById(`audio-${remoteUserId}`);
      if (remoteAudio) remoteAudio.remove();
    }

    // Reset WebRTC state variables
    peerConnections = {};
    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.remove();
    currentCall = null;
    const group = activeGroupsData.find((g) => g.id == window.currentGroupId);
    if (group) renderChatHeader(group, false); // Restore chat header
  };

  // Function to send a message via Sockets (Real-time)
  window.sendSocketMessage = () => {
    // Made global for HTML access
    const input = document.getElementById("message-input");
    if (!input) return;

    const content = input.value.trim();
    if (content && window.currentGroupId) {
      // This triggers the real-time broadcast on the server
      socket.emit("send-message", {
        groupId: window.currentGroupId,
        content: content,
      });
      input.value = ""; // Clear input immediately
    } else {
      console.error("Cannot send: Group not selected or empty content");
    }
  };

  // Attach Enter key listener to the input field
  const messageInput = document.getElementById("message-input");
  if (messageInput) {
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") window.sendSocketMessage();
    });
  }

  // Function to append messages to chat body
  function appendMessage(m) {
    const chatBox = document.getElementById("chatBody");
    if (!chatBox) return;

    const isMe = m.user_id === user.id;
    let messageContent = m.content || "";
    let fileName = "";

    if (m.type === "image") {
      messageContent = `<img src="${m.file_url}" style="max-width: 100%; border-radius: 8px; display: block;">`;
    } else if (m.type === "video") {
      messageContent = `<video src="${m.file_url}" controls style="max-width: 100%; border-radius: 8px; display: block;"></video>`;
    } else if (m.type === "audio") {
      // New: Audio rendering
      messageContent = `<audio controls src="${m.file_url}" style="max-width: 100%; display: block;"></audio>`;
    } else if (m.type === "document") {
      // New: Document rendering
      fileName = m.file_url.substring(m.file_url.lastIndexOf("/") + 1);
      messageContent = `<a href="${m.file_url}" target="_blank" style="color: inherit; text-decoration: underline;"><i class="fas fa-file"></i> ${fileName}</a>`;
    }

    const msgHtml = `
            <div class="message ${isMe ? "sent" : "received"}" style="margin-bottom: 10px; text-align: ${isMe ? "right" : "left"}">
                <div style="font-size: 0.8rem; color: #888;">${m.user_name} <span style="font-size: 0.7rem; color: var(--primary, #007bff); text-transform: uppercase; font-weight: bold;">[${m.user_role}]</span></div>
                <div style="display: inline-block; padding: 10px; border-radius: 10px; background: ${isMe ? "var(--primary, #007bff)" : "#eee"}; color: ${isMe ? "white" : "black"}; max-width: 70%;">
                    ${messageContent}
                </div>
            </div>
        `;
    chatBox.insertAdjacentHTML("beforeend", msgHtml);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // LOAD MESSAGES
  async function loadMessages(groupId) {
    try {
      const response = await fetch(`/api/groups/${groupId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to fetch messages");
      const messages = await response.json();
      const chatBody = document.getElementById("chatBody");
      chatBody.innerHTML = "";

      messages.forEach((m) => {
        appendMessage(m);
      });
      chatBody.scrollTop = chatBody.scrollHeight;
    } catch (err) {
      console.error("Load messages error:", err);
    }
  }

  // BACK BUTTON - Logic moved to window.closeChat and dynamic rendering

  // Profile Update Logic
  // Update profile bar display
  const pName = document.getElementById("profileName");
  const pInitial = document.getElementById("profileInitial");
  const pMainImg = document.getElementById("display-profile-pic-main");

  if (pName) pName.innerText = user.name;

  if (user.profile_image && pMainImg) {
    pMainImg.src = user.profile_image;
    pMainImg.style.display = "block";
    if (pInitial) pInitial.style.display = "none";
  } else if (pInitial) {
    pInitial.innerText = (user.name || "U").charAt(0).toUpperCase();
    pInitial.style.display = "flex";
    if (pMainImg) pMainImg.style.display = "none";
  }

  // PROFILE MODAL LOGIC
  const profileBar = document.querySelector(".profile-bar");
  const profileModal = document.getElementById("profileModal");
  const updateNameInput = document.getElementById("updateName");
  const profileImg = document.getElementById("display-profile-pic");
  const fileInput = document.getElementById("profile-pic-input");

  let pendingProfileImage = null;

  profileBar.style.cursor = "pointer";
  profileBar.onclick = () => {
    updateNameInput.value = user.name;
    if (user.profile_image && profileImg) {
      profileImg.src = user.profile_image;
      profileImg.style.display = "block";
    }
    pendingProfileImage = user.profile_image;
    profileModal.style.display = "flex";
  };

  document.getElementById("closeModal").onclick = () => {
    profileModal.style.display = "none";
  };

  document.getElementById("saveProfileBtn").onclick = async () => {
    const newName = updateNameInput.value.trim();

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName || undefined,
          profile_image: pendingProfileImage,
        }),
      });
      const data = await response.json();

      if (data.success) {
        user.name = data.user.name;
        user.profile_image = data.user.profile_image;
        localStorage.setItem("chat_user", JSON.stringify(user));

        document.getElementById("profileName").innerText = user.name;
        const initial = document.getElementById("profileInitial");
        initial.innerText = user.name.charAt(0).toUpperCase();

        // Toggle visibility between initial and image
        if (user.profile_image) {
          initial.style.display = "none";
          // Update the display pic in the main UI if it exists
          const mainProfilePic = document.getElementById(
            "display-profile-pic-main",
          );
          if (mainProfilePic) {
            mainProfilePic.src = user.profile_image;
            mainProfilePic.style.display = "block";
          }
        } else {
          initial.style.display = "flex";
          const mainProfilePic = document.getElementById("display-profile-pic-main");
          if (mainProfilePic) mainProfilePic.style.display = "none";
        }

        profileModal.style.display = "none";
        showToast("Profile updated successfully!");
      } else {
        showToast(data.error || "Update failed");
      }
    } catch (err) {
      showToast("Server error. Please try again later.");
    }
  };

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024)
        return showToast("Image is too large (max 10MB).");

      // Use the existing upload API instead of Base64
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload?uploadType=media", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });
        const data = await res.json();

        if (data.success) {
          pendingProfileImage = data.file_url;
          if (profileImg) {
            profileImg.src = data.file_url;
            profileImg.style.display = "block";
          }
        } else {
          showToast(data.error || "Upload failed");
        }
      } catch (err) {
        showToast("Error uploading profile image");
      }
    });
  }

  document.getElementById("logoutBtn").onclick = async () => {
    if (await showAlert("Are you sure you want to log out?")) {
      localStorage.removeItem("chat_token");
      localStorage.removeItem("chat_user");
      localStorage.removeItem("chat_isLoggedIn");
      window.location.href = "/chatapp/login.html";
    }
  };
});
