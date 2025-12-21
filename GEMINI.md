# LUMOSNAP DESKTOP

Desktop client for lumosnap, a photo sharing app, for photographers to bulk share photos to clients and get feedbacks. Project is built with electron js , vue 3, tailwindcss 4, vite and typescript, use pnpm as package manager

## Features

- create albums in which we will select a folder and it will automatically bulk upload all the images
- view albums and see the images in the album


## App Description 
my app Lumosnap is designed to compress and share large amounts image to someone without having to relay on google drive or other expensive hosting platforms or messaging platforms, also sharing 5000,10000 photos of size 10-50MB for them to choose some out of it, they will have to download all to see the photo, and even after they find their picks, its harder to track if they just send via message. Designed for photographers who cover weddings and other events where everything is of time and you have to cover the event and get nice shots for the album, and send for client approval for feed back. So our app will contain interfaces, 1 desktop app built with electron and vue js (photographer picks a folder, we use avif or webp to compress them into our folder and upload to our server), 2nd is the central piece, a hono js worker hosted in cloudflare that keeps track of the uploaded files, albums, links, favorites piked by user, auth and billing for user, generating signed urls for upload and all (we use honojs, drizzle, zod, postgres(from supabase) to create api) and our final piece is the web interface designed to display the images and albums and help user pick their favorites. we use backblaze b2 for image storage service.