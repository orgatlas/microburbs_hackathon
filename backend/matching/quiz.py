"""The onboarding quiz. The backend owns it so the extension and website render
the same questions. Each `id` is a key in the profile sent to POST /api/match."""

QUIZ = {
    "version": 1,
    "questions": [
        {
            "id": "buyer_type",
            "type": "single",
            "title": "What brings you to the market?",
            "options": [
                {"value": "first_home", "label": "Buying my first home"},
                {"value": "upgrader", "label": "Moving somewhere better"},
                {"value": "downsizer", "label": "Downsizing"},
                {"value": "investor", "label": "Buying an investment"},
            ],
        },
        {
            "id": "budget_max",
            "type": "number",
            "title": "What's the most you'd spend?",
            "unit": "AUD",
            "min": 300000,
            "max": 10000000,
            "step": 50000,
        },
        {
            "id": "household",
            "type": "single",
            "title": "Who will live there?",
            "options": [
                {"value": "solo", "label": "Just me"},
                {"value": "couple", "label": "Me and a partner"},
                {"value": "family", "label": "Family with kids"},
                {"value": "share", "label": "Friends or housemates"},
            ],
        },
        {
            "id": "min_bedrooms",
            "type": "single",
            "title": "How many bedrooms do you need?",
            "options": [
                {"value": 1, "label": "1+"},
                {"value": 2, "label": "2+"},
                {"value": 3, "label": "3+"},
                {"value": 4, "label": "4+"},
            ],
        },
        {
            "id": "vibe",
            "type": "single",
            "title": "What should your street feel like?",
            "options": [
                {"value": "quiet", "label": "Calm and leafy"},
                {"value": "balanced", "label": "A bit of both"},
                {"value": "buzzing", "label": "Right in the action"},
            ],
        },
        {
            "id": "commute_modes",
            "type": "multi",
            "title": "How do you get around?",
            "options": [
                {"value": "train", "label": "Train"},
                {"value": "bus", "label": "Bus"},
                {"value": "tram", "label": "Light rail"},
                {"value": "ferry", "label": "Ferry"},
                {"value": "car", "label": "I mostly drive"},
            ],
        },
        {
            "id": "must_haves",
            "type": "multi",
            "title": "What do you want within walking distance?",
            "options": [
                {"value": "supermarket", "label": "Supermarket"},
                {"value": "green_spaces", "label": "Parks and green space"},
                {"value": "restaurant", "label": "Cafes and restaurants"},
                {"value": "schools", "label": "Good schools"},
            ],
        },
        {
            "id": "weights",
            "type": "weights",
            "title": "What matters most to you?",
            "help": "Share 100 points between the three.",
            "options": [
                {"value": "lifestyle", "label": "Lifestyle & Community"},
                {"value": "price", "label": "Price"},
                {"value": "safety", "label": "Safety"},
            ],
        },
    ],
}
