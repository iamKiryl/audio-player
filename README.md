This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Mobile Support

The audio player layout uses responsive Tailwind CSS classes so it adapts to smaller screens automatically. When viewed on phones, control sizes and spacing scale down for a comfortable mobile experience.

## Playing local files

Songs are picked from your computer with **Add new song** and played straight from the browser; nothing is uploaded. After a page reload the songs need to be picked again.

- The queue plays in order and stops after the last track. Next/Previous wrap around.
- Click, tap, or drag the playback progress bar to seek within a song. When focused, arrow keys seek by 5 seconds; Home/End jump to the start/end. Seeking keeps paused tracks paused.
- Drag around the wheel to change volume (clockwise is louder); with the wheel focused, arrow keys change it in steps of 5.
- Files that can't be read are skipped and listed at the bottom of the screen.
