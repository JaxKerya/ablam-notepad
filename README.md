# Ablam NotePad

A minimal, real-time collaborative notepad. Dark theme, distraction-free, link-based access. No accounts, no clutter — just notes.

## Tech Stack

- **Next.js** (App Router)
- **Tailwind CSS**
- **TipTap** (rich text editor)
- **Supabase** (database + real-time sync)

## Getting Started

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once the project is ready, go to **Settings > API** and copy your:
   - **Project URL** (e.g. `https://abcdefg.supabase.co`)
   - **anon/public key**

### 2. Run the Database Schema

Open the **SQL Editor** in your Supabase dashboard and run the following:

```sql
-- Create the notes table (TEXT id for custom note names)
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  content JSONB DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: public read/write by note ID
CREATE POLICY "Allow public read by id"
  ON notes FOR SELECT USING (true);

CREATE POLICY "Allow public insert"
  ON notes FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update by id"
  ON notes FOR UPDATE USING (true);

CREATE POLICY "Allow public delete by id"
  ON notes FOR DELETE USING (true);

-- Required for Supabase Realtime to send full row data on UPDATE
ALTER TABLE notes REPLICA IDENTITY FULL;
```

### 2b. Run Migration SQL (New Features)

If you already have an existing `notes` table, run this migration:

```sql
-- Pin support
ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;

-- Password protection
ALTER TABLE notes ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT NULL;
```

### 2c. Setup Supabase Storage (for Image Upload)

1. Go to **Storage** in your Supabase Dashboard
2. Create a new bucket called **`note-images`**
3. Set the bucket to **Public**
4. Add an RLS policy to allow uploads:

```sql
CREATE POLICY "Allow public upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'note-images');

CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'note-images');
```

### 3. Enable Realtime

In your Supabase dashboard:

1. Go to **Database > Replication**
2. Find the `notes` table and **enable Realtime** for it

This is required for live sync between multiple users.

### 4. Configure Environment Variables

Copy the example file and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Install Dependencies & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a custom note name (e.g. `my-shopping-list`) to create or open a note.

Share the URL (e.g. `http://localhost:3000/note/my-shopping-list`) with anyone — they'll see live updates in real time.

## Deployment (Vercel)

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. Add your environment variables in the Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Your app will be live at your Vercel URL.

## Project Structure

```
ablam-notepad/
├── app/
│   ├── layout.tsx            # Root layout, dark theme, Inter font
│   ├── page.tsx              # Landing page with note input + sidebar (pin support)
│   ├── not-found.tsx         # 404 page
│   ├── globals.css           # Global styles + TipTap editor styles
│   └── note/
│       └── [id]/
│           ├── page.tsx      # Note editor page (password gate)
│           └── NotePageClient.tsx  # Client wrapper for locked notes
├── components/
│   ├── NoteEditor.tsx        # TipTap editor with auto-save & real-time sync
│   ├── Toolbar.tsx           # Formatting toolbar (Headings, Bold, Italic, Links, Images...)
│   ├── PasswordGate.tsx      # Password entry screen for locked notes
│   └── PasswordSetup.tsx     # Set/remove password UI
├── lib/
│   ├── supabase-browser.ts   # Browser Supabase client
│   ├── supabase-server.ts    # Server Supabase client
│   ├── crypto.ts             # SHA-256 password hashing
│   └── upload.ts             # Supabase Storage image upload
├── .env.local.example        # Environment variables template
└── README.md
```

## Features

- **Auto-save**: Every change is saved automatically (500ms debounce)
- **Real-time sync**: Multiple users see changes instantly via Supabase Realtime
- **Custom note names**: Choose your own URL slug (e.g. `/note/my-list`)
- **Link-based access**: No accounts needed — just share the URL
- **Rich text**: Bold, Italic, Underline, Headings (H1-H3), Bullet Lists, Numbered Lists, Task Lists
- **Hyperlinks**: Add clickable links to text with a URL popup
- **Image upload**: Upload images via Supabase Storage with drag-and-drop support
- **Pin notes**: Pin important notes to the top of the sidebar
- **Password protection**: Lock notes with a password (SHA-256 hashed)
- **Dark theme**: Clean, modern, distraction-free UI
