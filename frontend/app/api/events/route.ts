import { NextResponse } from "next/server";
import { getNextRoomEvent } from "@/lib/roomEventDeck";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId") ?? "default";

    const event = await getNextRoomEvent(roomId);

    if (!event) {
      return NextResponse.json(
        { error: "No events available" },
        { status: 500 },
      );
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error("[api/events] Unexpected error while fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}

