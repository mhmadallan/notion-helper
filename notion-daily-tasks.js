const axios = require('axios');
require('dotenv').config(); // <-- load .env in the current working dir
// ✅ Replace with your Notion secret
const NOTION_TOKEN = process.env.NOTION_TOKEN;

// ✅ Replace with your Notion database ID
const DATABASE_ID = process.env.DATABASE_ID;


// ✅ Headers for all requests
const headers = {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
};

// ✅ Tasks with targets & emojis
const tasks = [
    { name: "Teeth Brush", target: 7, emoji: "🪥", unit: "Times" },
    { name: "Beard Care", target: 1, emoji: "🧔‍♂️", unit: "Times" },
    { name: "Face Care", target: 3, emoji: "💆‍♂️", unit: "Times" },
    { name: "Hair Care", target: 1, emoji: "💇", unit: "Times" },
    { name: "Small Hair Trimming", target: 2, emoji: "✂️", unit: "Times" },
    { name: "Ears Cleaning", target: 7, emoji: "👂", unit: "Times" },
    { name: "Nose Cleaning", target: 7, emoji: "👃", unit: "Times" },
    { name: "Nails Clipping", target: 1, emoji: "💅", unit: "Times" },
    { name: "Code Taskatna", target: 2, emoji: "👨‍💻", unit: "Hours" },
    { name: "Code Bayan", target: 2, emoji: "💻", unit: "Hours" },
    { name: "Code Baytna", target: 3, emoji: "🏘️", unit: "Hours" },
    { name: "Code Makhzan", target: 3, emoji: "🌵", unit: "Hours" },
    { name: "Sys Admin", target: 3, emoji: "🖥️", unit: "Hours" },
    { name: "Hacking Skills", target: 2, emoji: "🕵️", unit: "Hours" },
    { name: "Book Review", target: 2, emoji: "📚", unit: "Books" },
    { name: "Gym Legs Lie Up", target: 3, emoji: "🦵", unit: "35kg * 40rep" },
    { name: "Gym Chest Wide", target: 3, emoji: "🙆", unit: "40kg * 40rep" },
    { name: "Gym Chest Up", target: 3, emoji: "🧎", unit: "35kg * 40rep" },
    { name: "Gym Biceps", target: 4, emoji: "💪", unit: "35kg * 40rep" },
    { name: "Gym Treadmill", target: 5, emoji: "🏃", unit: "200cal" },
    { name: "Gym Robe Pull Down", target: 3, emoji: "🤾‍♂️", unit: "35kg * 40rep" },
    { name: "Gym Robe Pull", target: 3, emoji: "🤾", unit: "35kg * 40rep" },
    { name: "Gym Weight Lift Reverse", target: 4, emoji: "🏋️", unit: "35kg * 40rep" },
    { name: "Gym Stomach Normal", target: 3, emoji: "🧘", unit: "40rep" },
    { name: "Healthy Food", target: 4, emoji: "🫑", unit: "Times" },
    { name: "Quran Verse", target: 2, emoji: "📖", unit: "Verses/Pages" },
    { name: "Hadith", target: 2, emoji: "🕌", unit: "Hadithes" },
    { name: "Dua", target: 7, emoji: "🤲", unit: "Times" },
    { name: "Fasting", target: 1, emoji: "☪️", unit: "Times" },
    { name: "Fajr", target: 7, emoji: "☪️", unit: "Times" },
    { name: "Duhr", target: 7, emoji: "☪️", unit: "Times" },
    { name: "Asr", target: 7, emoji: "☪️", unit: "Times" },
    { name: "Maghreb", target: 7, emoji: "☪️", unit: "Times" },
    { name: "Ishaa", target: 7, emoji: "☪️", unit: "Times" },
    { name: "Garden", target: 4, emoji: "🌻", unit: "Hours" },
    { name: "Girls Play", target: 4, emoji: "🚸", unit: "Times" },
    { name: "Bathing", target: 2, emoji: "🛀", unit: "Times" },
    { name: "Shopping", target: 2, emoji: "🛒", unit: "Times" },
    { name: "No Porn", target: 7, emoji: "🚫", unit: "Times" },
    { name: "No Smoking", target: 7, emoji: "🚭", unit: "Times" },
    { name: "3D Prints", target: 3, emoji: "🖨️", unit: "Hours" },
    { name: "Cadeau Projects", target: 3, emoji: "🎁", unit: "Hours" },
    { name: "Learn Life Tricks", target: 4, emoji: "🎩", unit: "Tricks" },
    { name: "Sadaqa", target: 1, emoji: "💶", unit: "25 Euro" },
    { name: "Visit Family", target: 2, emoji: "👨‍👩‍👧", unit: "Hours" },
    { name: "German", target: 4, emoji: "🇩🇪", unit: "Hours" },
    { name: "Car Care", target: 2, emoji: "🚗", unit: "Hours" },
    { name: "Social Media Life", target: 3, emoji: "#️⃣", unit: "Posts" },

];

// ---- helpers ----

// Get YYYY-MM-DD for “today”.
function isoToday() {
    return new Date().toISOString().split('T')[0];
}

// Get YYYY-MM-DD for "tomorrow"
function isoTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}


// Return all page IDs for this task in current week (Sun → today)
async function getThisWeeksPageIds(taskName, todayISO) {
    const today = new Date(todayISO);
    const dayOfWeek = today.getDay(); // 0 = Sunday
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);

    const startISO = startOfWeek.toISOString().split('T')[0];

    const res = await axios.post(
        `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
        {
            filter: {
                and: [
                    { property: "Task", title: { equals: taskName } },
                    { property: "Task Date", date: { on_or_after: startISO } },
                    { property: "Task Date", date: { on_or_before: todayISO } }
                ]
            }
        },
        { headers }
    );

    const ids = res.data.results.map(p => p.id);
    // console.log(`🔎 ${taskName} week IDs:`, ids);
    return ids;
}

// Find master row (title must match & Is Master = true)
async function findMasterTaskId(taskName) {
    const res = await axios.post(
        `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
        {
            filter: {
                and: [
                    { property: "Task", title: { equals: taskName } },
                    { property: "Is Master", checkbox: { equals: true } }
                ]
            }
        },
        { headers }
    );
    if (!res.data.results.length) {
        throw new Error(`Master task not found for "${taskName}" (check "Is Master").`);
    }
    return res.data.results[0].id;
}

function uniqueIds(ids) {
    return Array.from(new Set(ids));
}

// ---- main create ----

async function createTask(task) {
    try {
        // Get start of week (Sunday) in ISO format
        const todayISONow = isoToday();
        const today = new Date(todayISONow);
        const dayOfWeek = today.getDay(); // 0 = Sunday
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - dayOfWeek);
        const startISO = startOfWeek.toISOString().split('T')[0];


        const todayISO = isoToday();
       // const todayISO = isoTomorrow();

        const masterId = await findMasterTaskId(task.name);
        const weekPageIds = await getThisWeeksPageIds(task.name, todayISO);

        // Build relation: all week pages + master (deduped)
        const relationIds = uniqueIds([...weekPageIds, masterId]);

        // 1) Create today’s page with relation to week pages + master
        const createRes = await axios.post(
            'https://api.notion.com/v1/pages',
            {
                parent: { database_id: DATABASE_ID },
                icon: { type: "emoji", emoji: task.emoji },
                properties: {
                    "Task": { title: [{ text: { content: task.name } }] },
                    "Task Date": { date: { start: todayISO } },
                    "Done": { checkbox: false },
                    "Target": { number: task.target },
                    "Relation": { relation: relationIds.map(id => ({ id })) }, // <-- property name must match your DB
                    "Unit": {
                        rich_text: [{ text: { content: task.unit } }]
                    },
                    "Week Start": { date: { start: startISO } } // Add week start date
                }
            },
            { headers }
        );

        const newPageId = createRes.data.id;

        // 2) Patch to ensure relation also includes the NEW page itself (and master)
        const finalIds = uniqueIds([...relationIds, newPageId]);
        await axios.patch(
            `https://api.notion.com/v1/pages/${newPageId}`,
            { properties: { "Relation": { relation: finalIds.map(id => ({ id })) } } },
            { headers }
        );

        console.log(`✅ Created: ${task.name} | relations: ${finalIds.length}`);
    } catch (err) {
        console.error(`❌ Failed: ${task.name}`);
        console.error(err.response?.data || err.message);
    }
}

async function run() {
    console.log(`🟢 Creating tasks for ${isoToday()}...`);
    for (const task of tasks) {
        await createTask(task);
    }
}

run();
