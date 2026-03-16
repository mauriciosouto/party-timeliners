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

The host can start the game at any time.

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

# Room Settings

The host may configure:

- room name
- points required to win
- optional turn time limit
- maximum timeline size (default: 50 events)

Settings cannot be changed once the match starts.

---

# Player Disconnections

If a player disconnects during their turn:

- the turn is skipped

Players can reconnect using the same nickname and email.

If the host disconnects:

- the match continues normally

If a player refreshes the browser:

- they should automatically reconnect.

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
- real-time multiplayer via WebSockets (invite link, lobby, turn-based play)
- UI polish: hero/glass panels, results screen, confetti, sounds, timer feedback, error toasts, drag feedback