// app/api/instagram/[username]/route.ts
//
// Free Instagram feed proxy — no Smash Balloon license needed.
//
// HOW IT WORKS:
//   Instagram's Basic Display API requires each user to authorise the app.
//   For a business use case, use the Instagram Graph API instead:
//     1. Connect the salon's Instagram Page to a Facebook Business Page
//     2. The owner grants your Facebook App "instagram_basic" + "pages_read_engagement" scopes
//     3. Exchange for a long-lived Page Access Token, store it in partner_salons.instagram_token
//     4. This route fetches from the Graph API using that token
//
// QUICK-START (for testing with a single account):
//   - Get a long-lived User Access Token from developers.facebook.com/tools/explorer
//   - Set INSTAGRAM_TEST_TOKEN in your .env.local
//   - This returns up to 9 recent image posts
//
// For production: store per-salon tokens in partner_salons.instagram_token (add the column)
// and look up by username param.

import { NextRequest, NextResponse } from "next/server";

const TEST_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";

export async function GET(
  request: NextRequest,
  { params }: { params: { username: string } }
) {
  // In production: look up the token for this salon from your DB.
  // For now we use the single test token.
  const token = TEST_TOKEN;

  if (!token) {
    return NextResponse.json(
      { posts: [], error: "Instagram not configured" },
      { status: 200 } // return empty gracefully — UI shows a link instead
    );
  }

  try {
    // Step 1: get the user's IG business account ID
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${token}`,
      { next: { revalidate: 3600 } } // cache 1 hour
    );
    if (!meRes.ok) throw new Error("Failed to fetch IG user");
    const me = await meRes.json();

    // Step 2: fetch recent media
    const mediaRes = await fetch(
      `https://graph.instagram.com/${me.id}/media?fields=id,media_type,media_url,permalink,caption&limit=9&access_token=${token}`,
      { next: { revalidate: 3600 } }
    );
    if (!mediaRes.ok) throw new Error("Failed to fetch IG media");
    const media = await mediaRes.json();

    // Only return IMAGE and CAROUSEL_ALBUM types (not REELS videos which lack media_url)
    const posts = (media.data ?? []).filter(
      (p: { media_type: string }) => p.media_type === "IMAGE" || p.media_type === "CAROUSEL_ALBUM"
    );

    return NextResponse.json({ posts, username: me.username });
  } catch (err) {
    console.error("Instagram API error:", err);
    return NextResponse.json({ posts: [], error: "Failed to load Instagram feed" }, { status: 200 });
  }
}
