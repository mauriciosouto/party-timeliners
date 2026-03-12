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

Each player receives a hidden event card containing:

- title
- description
- optional image

The player must drag the card into the correct position on the timeline.

After placement the game reveals the event's year and determines if the placement was correct.

### If correct

- event stays in the timeline
- player gains 1 point

### If incorrect

- correct position is revealed
- player gains 0 points

Events are always sorted chronologically.

Events occurring in the same year are considered interchangeable.

---

# Game Flow

## Lobby

Players join a room using a shared link.

Players must enter:

- nickname
- email (used only for reconnection)

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

Players take turns in a predefined random order.

Each turn:

1. Player receives a hidden event card.
2. Player drags the card onto the timeline.
3. Player selects a position between existing events.
4. The game validates the placement.

---

# Game End Conditions

The game ends when:

- the timeline reaches the maximum configured size
- OR the event pool is exhausted

The player with the highest score wins.

After the game ends players return to the lobby.

The lobby displays:

- final scores
- winner
- option to play again

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

Timeline interactions should feel smooth and responsive.

Drag and drop interactions must be intuitive.

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

# Current Development Goal

Build the first playable prototype including:

- timeline component
- draggable event card
- droppable timeline slots
- event placement validation
- simple scoring logic

Multiplayer functionality will be added after the core gameplay loop works locally.