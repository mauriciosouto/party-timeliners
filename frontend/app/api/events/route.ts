import { NextResponse } from "next/server";
import { getGlobalEvents } from "@/lib/eventPool";

/** Fallback when backend is unavailable: pick one random event from the global pool. */
export async function GET() {
  try {
    const pool = await getGlobalEvents();
    if (pool.length === 0) {
      return NextResponse.json(
        { error: "No events available" },
        { status: 500 },
      );
    }
    const event = pool[Math.floor(Math.random() * pool.length)]!;
    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        year: event.year,
        displayTitle: event.displayTitle,
        image: event.image,
        wikipediaUrl: event.wikipediaUrl,
      },
    });
  } catch (error) {
    console.error("[api/events] Unexpected error while fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
