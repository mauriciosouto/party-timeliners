# Party Timeliners — Project Context

## Overview

Party Timeliners is a casual multiplayer browser game where players place historical events in chronological order on a shared timeline.

The game is designed to be:

- simple to learn
- fast to play
- fun with friends
- playable directly in the browser
- requiring no account creation

Players join a room via an invitation link and play together in real time.

---

# Core Gameplay

Players take turns placing historical events into a shared timeline.

**Hand system:** At the start of the match each player receives **3 event cards** (their hand). All cards are unique and drawn from the same event pool; no event is duplicated between players or on the timeline.

Each card shows (hidden until placed):

- title
- description
- optional image

On a player's turn they choose **one card from their hand** and drag it to the correct position on the timeline. After placement the game reveals the event's year and determines if the placement was correct.

### If correct

- event stays in the timeline
- player gains 1 point
- player draws **one new card** from the pool (hand stays at 3)

### If incorrect

- correct position is revealed
- player gains 0 points
- player still draws **one replacement card** (hand stays at 3)

Hand size is always 3: after every placement (correct or not) the played card is removed from the hand and one new card is drawn from the remaining pool. No event appears twice in the game.

Events are always sorted chronologically.

Events occurring in the same year are considered interchangeable.

---

# Game Flow

## Lobby

Players join a room using a shared link.

Players must enter:

- nickname

Lobby shows:

- room name
- room settings
- list of connected players

The host can **Start game** at any time or **Close room** to end the room permanently (everyone is sent to home and the room is deleted). Non-host players can **Leave room** at any time (button); they are removed from the room and redirected home.

Minimum players required: 1.

Once the game starts no new players may join.

---

## Game Start

The timeline begins with one revealed historical event.

Each player is dealt 3 unique event cards from the pool (no duplicates). Players take turns in a predefined random order.

Each turn:

1. The active player chooses one card from their hand.
2. They drag it onto the timeline and select a position between existing events.
3. The game validates the placement.
4. The card is removed from their hand and they draw one new card from the pool (hand remains 3).

---

# Game End Conditions

The game ends when:

- the timeline reaches the maximum configured size
- OR the event pool is exhausted

The player with the highest score wins.

After the game ends the room shows a **Match Results** screen:

- winner (highlighted card or podium for 2+ players)
- full player ranking with scores
- Play again (rematch) or End game

Players stay in the room until they leave or the host starts a rematch.

---

# Leaving and closing a room

Only **non-host** players can voluntarily **leave** a room (Leave room / Leave game). The host can **End game** to return everyone to the lobby, or **Close room** to end the room permanently.

**Close room** is available in the lobby and after the game has ended. When the host chooses it, the room is deleted, all connected players (including the host) receive a “room closed” signal and are redirected to home. Stored credentials for that room are cleared so the room link no longer allows rejoin.

**From the lobby:** The player clicks “Leave room”; they are removed from the participant list and redirected home. No other side effects.

**During the game:** The player clicks “Leave game” (header). Behaviour:

- Their **already-placed cards remain** on the timeline.
- They are **removed from the participant list** and their **score is not counted** in the final results.
- If it was **their turn**, the turn is considered finished (no card is placed) and the turn passes to the next player normally.
- If it was **not their turn**, they simply leave; the current turn is unchanged.
- If fewer than 2 players remain after someone leaves, the room **resets to lobby** (same as “End game”): timeline and hands are cleared, host remains.

All other players in the room receive a **notification** that “X left the game” (toast, auto-dismiss). The client that left receives an acknowledgment and is redirected home; their stored credentials for that room are cleared so they are not offered rejoin.

---

# Player Avatar System

Before entering a room (create or join), each user chooses a **nickname** and an **avatar**.

**Avatar assets:** Stored under `frontend/public/avatars/` as `character-1.png` through `character-18.png`. The app exposes a centralized list (`AVAILABLE_AVATARS` in `frontend/lib/avatars.ts`).

**Selection flow:**

1. On **Create room** (home): user enters nickname, optional room name, and picks an avatar from a grid before submitting.
2. On **Join room**: user enters nickname and picks an avatar before joining.
3. If the user does not select an avatar, a **random** one is assigned from the list.

**Player model:** Each player has an `avatar` field (string, URL path e.g. `"/avatars/character-5.png"`). It is stored in the room’s player record and synchronized with the rest of the game state (no gameplay logic depends on it).

**Where avatars appear:**

- **Lobby:** Player list shows avatar + nickname for each player.
- **Gameplay:** Aside player list, turn indicator, and “Your hand” section show the active player’s avatar.
- **Results screen:** Winner card and ranking list show each player’s avatar.

Avatars are optional: if missing, the UI shows a fallback (e.g. initial letter).

---

# Room Settings

The host may configure:

- room name
- points required to win
- optional turn time limit
- maximum timeline size (default: 50 events)

Settings cannot be changed once the match starts.

---

# Player Disconnections

**Voluntary leave** is handled separately: see “Leaving a room”. The player explicitly clicks “Leave room” or “Leave game” and is removed from the room; others are notified.

**Involuntary disconnect** (network drop, close tab, refresh):

- If a player disconnects during their turn, the turn can be skipped (e.g. by a timeout or host action).
- Players can reconnect using the same nickname (and stored credentials for that room).
- If the host disconnects, the match can continue; when they reconnect they rejoin as host.
- If a player refreshes the browser, they should automatically reconnect using stored room credentials.

---

# Historical Events

Historical events are fetched dynamically from external APIs.

Preferred sources:

- Wikidata
- Wikipedia

The system should avoid storing a full historical database locally.

Events must contain:

- id
- title
- year
- description
- optional image
- Wikipedia link
- optional category

Allowed properties:

- events may include images
- missing images are acceptable
- events may be BCE
- events cannot be in the future

Events must never repeat within the same match.

---

# Timeline Behavior

The timeline is the central UI component.

Characteristics:

- horizontal layout
- scrollable
- events displayed as cards
- cards show title, year, and optional image

Players drag event cards to insert between existing timeline events.

Droppable zones exist between every event.

Example timeline:

[ 1492 ] — [ 1776 ] — [ 1914 ] — [ 1969 ]

A player may place a new event between any pair.

---

# Visual Design

Design goals:

- modern party game style
- playful but clean UI
- smooth animations
- bright colors
- clear feedback for correct vs incorrect placement

**Screens and layout:**

- **Home / Lobby / Join:** Hero background image with dark overlay; glass-style panels for forms and player list.
- **Game room:** Blurred background with dark overlay; header, timeline, “card to place” section, and player list (sidebar).
- **Match results:** Horizontal layout with winner card (or podium for 2+ players), ranking list, and Play again / End game.

**Timeline and cards:**

- Horizontal scrollable timeline with a visible line; droppable slots between events with hover/drag feedback.
- Event cards: rounded corners, soft shadow, hover lift; when dragging, scale and stronger shadow; on correct place, brief “settle” animation.
- Timeline glows subtly when a card is being dragged; slot under the cursor is highlighted.

**Audio feedback:**

- Correct placement: short sound + confetti.
- Incorrect placement: short sound.
- Game end (winner): victory confetti + victory sound.
- Game end (loser): defeat sound + brief overlay pulse.
- Turn timer: last 3 seconds play a tick (stops when turn ends); timer bar and number change color (green → yellow → orange → red) and pulse when low.
- New player joins lobby: short join sound.
- Match starts (lobby → playing): short game-start sound + brief screen flash.

**Other UI:**

- Errors (e.g. placement failed, room error): fixed top-center toast, auto-dismiss after a few seconds, red accent.
- Turn timer: progress bar and seconds; optional per-turn time limit.

---

# Technology Stack

Frontend

- Next.js
- React
- TypeScript
- TailwindCSS
- dnd-kit (drag and drop)

Backend

- Cloudflare Workers
- Durable Objects (game rooms)
- WebSockets for real-time communication

Infrastructure goals:

- extremely low cost
- scalable
- minimal persistence

Rooms should be isolated using Durable Objects.

---

# Multiplayer Architecture

Each room corresponds to a Durable Object instance.

The Durable Object manages:

- room state
- player list
- timeline state
- turn order
- scoring
- event validation

Communication between client and server uses WebSockets.

Clients send actions such as:

- join_room
- place_event
- start_game

Server broadcasts updated game state.

---

# UX Constraints

The game must work on:

- desktop browsers
- mobile browsers

No installation required.

Players only need:

- a browser
- an invitation link

Game setup must take less than 30 seconds.

---

# Content Safety

Event content originates from external sources such as Wikipedia.

Because historical content may include violent or sensitive topics, the game must display a disclaimer before joining.

Players must accept the disclaimer to enter a room.

Room hosts may optionally report problematic events.

Reported events should be excluded from future matches if possible.

---

# Development Philosophy

Development should follow these principles:

1. Keep the architecture simple.
2. Build playable features as early as possible.
3. Avoid premature optimization.
4. Prefer clarity over cleverness.
5. Maintain clean TypeScript code.
6. Ensure the project remains easy to deploy.

---

# Current State

The game is a playable multiplayer prototype with:

- timeline component and draggable event cards with droppable slots
- event placement validation and scoring on the server
- real-time multiplayer via WebSockets (invite link, lobby, turn-based play, leave room)
- **Player avatars:** choose on create/join, shown in lobby, turn indicator, and results
- **Leave room:** non-host can leave from lobby or during the game; turn advances if it was their turn; others get “X left the game” notification; room resets to lobby if &lt; 2 players remain
- **Close room:** host can close the room from the lobby or after the game has ended; room is deleted, everyone receives room_closed and redirects to home
- UI polish: hero/glass panels, results screen, confetti, sounds, timer feedback, error toasts, drag feedback, “player left” toast