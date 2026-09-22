import json
import re
import os

numbered_path = "data/website-posts.json"
unnumbered_path = "data/website-posts-unnumbered.json"

with open(numbered_path, 'r', encoding='utf-8') as f:
    numbered_posts = json.load(f)

with open(unnumbered_path, 'r', encoding='utf-8') as f:
    unnumbered_posts = json.load(f)

new_unnumbered = []
migrated = []

regex = re.compile(r"^\s*POS[T]?\s*(?:NO|ON|NI)?\s*(\d+)\s*", re.IGNORECASE)

for post in unnumbered_posts:
    text = post.get('text', '')
    match = regex.search(text)
    if match:
        post_id = int(match.group(1))
        # Keep the text as is, or strip it?
        # User said: "why you now removed the text of the unnumberd posts... so add those posts on the numberd post". 
        # Numbered posts typically have "POST XXX" in their text or they don't?
        # Actually in website-posts.json, the text often contains "POST 123", wait, let's keep it as is to match original data.
        post['post_id'] = post_id
        migrated.append(post)
    else:
        new_unnumbered.append(post)

# Merge migrated posts into numbered posts
# First check if the post_id already exists in numbered_posts
existing_ids = {p['post_id'] for p in numbered_posts}

for m in migrated:
    if m['post_id'] in existing_ids:
        print(f"WARNING: Post {m['post_id']} already exists in numbered posts. Overwriting or skipping? We will overwrite for now.")
        # Remove old one
        numbered_posts = [p for p in numbered_posts if p['post_id'] != m['post_id']]
    numbered_posts.append(m)

# Sort numbered posts
numbered_posts.sort(key=lambda x: x['post_id'])

with open(numbered_path, 'w', encoding='utf-8') as f:
    json.dump(numbered_posts, f, separators=(',', ':'))

with open(unnumbered_path, 'w', encoding='utf-8') as f:
    json.dump(new_unnumbered, f, separators=(',', ':'))

print(f"Migrated {len(migrated)} posts.")
