import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllCategories,
    getAllPublishers,
    getAllGameIds,
    getGames,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('filters by one or more categories and publisher', async () => {
        const [strategy] = await db
            .insert(categories)
            .values({ name: 'Strategy', description: 'strategy' })
            .returning({ id: categories.id });
        const [puzzle] = await db
            .insert(categories)
            .values({ name: 'Puzzle', description: 'puzzle' })
            .returning({ id: categories.id });
        const [pubOne] = await db
            .insert(publishers)
            .values({ name: 'Pub One', description: 'one' })
            .returning({ id: publishers.id });
        const [pubTwo] = await db
            .insert(publishers)
            .values({ name: 'Pub Two', description: 'two' })
            .returning({ id: publishers.id });

        await db.insert(games).values([
            {
                title: 'Puzzle One',
                description: 'Puzzle',
                categoryId: puzzle.id,
                publisherId: pubOne.id,
            },
            {
                title: 'Strategy One',
                description: 'Strategy',
                categoryId: strategy.id,
                publisherId: pubOne.id,
            },
            {
                title: 'Strategy Two',
                description: 'Strategy',
                categoryId: strategy.id,
                publisherId: pubTwo.id,
            },
        ]);

        const categoryMatches = await getGames(db, {
            categoryIds: [strategy.id, puzzle.id],
        });
        expect(categoryMatches.map((game) => game.title)).toEqual([
            'Puzzle One',
            'Strategy One',
            'Strategy Two',
        ]);

        const combinedMatches = await getGames(db, {
            categoryIds: [strategy.id],
            publisherId: pubOne.id,
        });
        expect(combinedMatches.map((game) => game.title)).toEqual(['Strategy One']);
    });

    it('returns empty results for a category with no games', async () => {
        const [category] = await db
            .insert(categories)
            .values({ name: 'Unused', description: 'unused' })
            .returning({ id: categories.id });

        expect(await getGames(db, { categoryIds: [category.id] })).toEqual([]);
    });

    it('returns categories and publishers ordered by name', async () => {
        await db.insert(categories).values([
            { name: 'Strategy', description: 'strategy' },
            { name: 'Puzzle', description: 'puzzle' },
        ]);
        await db.insert(publishers).values([
            { name: 'Zeta', description: 'zeta' },
            { name: 'Alpha', description: 'alpha' },
        ]);

        expect((await getAllCategories(db)).map((category) => category.name)).toEqual(['Puzzle', 'Strategy']);
        expect((await getAllPublishers(db)).map((publisher) => publisher.name)).toEqual(['Alpha', 'Zeta']);
    });
});
