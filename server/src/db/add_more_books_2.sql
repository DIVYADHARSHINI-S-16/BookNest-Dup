-- 25 more catalog titles, added to broaden search/filter/category demo coverage.
-- Adds a few new categories (Fantasy, Self-Help, History, Science, Business)
-- alongside the existing ones. Purely additive: no existing rows are touched.

INSERT INTO categories (name, slug, description) VALUES
    ('Fantasy', 'fantasy', 'Epic worlds, magic, and adventure'),
    ('Self-Help', 'self-help', 'Habits, mindset, and personal growth'),
    ('History', 'history', 'How we got here'),
    ('Science', 'science', 'The natural world, explained'),
    ('Business', 'business', 'Startups, strategy, and the world of work')
ON CONFLICT (name) DO NOTHING;

INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
VALUES
    ('To Kill a Mockingbird', 'Harper Lee',
     'A young girl in the American South watches her father defend an innocent man, and learns hard lessons about justice along the way.',
     '9780061120084', 399, 'https://covers.openlibrary.org/b/isbn/9780061120084-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('Brave New World', 'Aldous Huxley',
     'A dystopian vision of a future society engineered for comfort and conformity, at the cost of freedom and feeling.',
     '9780060850524', 349, 'https://covers.openlibrary.org/b/isbn/9780060850524-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('The Catcher in the Rye', 'J.D. Salinger',
     'A restless teenager wanders New York City over a few days, wrestling with grief, alienation, and growing up.',
     '9780316769488', 299, 'https://covers.openlibrary.org/b/isbn/9780316769488-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('Little Women', 'Louisa May Alcott',
     'Four sisters grow up together through love, ambition, and loss in Civil War-era New England.',
     '9780147514011', 349, 'https://covers.openlibrary.org/b/isbn/9780147514011-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('The Da Vinci Code', 'Dan Brown',
     'A symbologist races across Europe to unravel a centuries-old conspiracy hidden in plain sight.',
     '9780307474278', 399, 'https://covers.openlibrary.org/b/isbn/9780307474278-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('The Girl with the Dragon Tattoo', 'Stieg Larsson',
     'A disgraced journalist and a brilliant hacker team up to solve a decades-old disappearance.',
     '9780307454546', 449, 'https://covers.openlibrary.org/b/isbn/9780307454546-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('The Shining', 'Stephen King',
     'A family''s winter at an isolated, haunted hotel slowly unravels into terror.',
     '9780307743657', 399, 'https://covers.openlibrary.org/b/isbn/9780307743657-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('And Then There Were None', 'Agatha Christie',
     'Ten strangers are lured to an island, and one by one, they start to disappear.',
     '9780062073488', 299, 'https://covers.openlibrary.org/b/isbn/9780062073488-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('The Fellowship of the Ring', 'J.R.R. Tolkien',
     'A hobbit sets out on a perilous journey to destroy a ring of great and terrible power.',
     '9780544003415', 549, 'https://covers.openlibrary.org/b/isbn/9780544003415-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Harry Potter and the Chamber of Secrets', 'J.K. Rowling',
     'Harry returns to Hogwarts for a second year, where a dark force is terrorizing the school.',
     '9780439064873', 499, 'https://covers.openlibrary.org/b/isbn/9780439064873-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('A Game of Thrones', 'George R.R. Martin',
     'Noble houses scheme for the Iron Throne while an ancient threat stirs beyond the Wall.',
     '9780553103540', 599, 'https://covers.openlibrary.org/b/isbn/9780553103540-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('The Night Circus', 'Erin Morgenstern',
     'Two young illusionists are bound in a magical competition staged within a mysterious, nocturnal circus.',
     '9780307744432', 449, 'https://covers.openlibrary.org/b/isbn/9780307744432-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Thinking, Fast and Slow', 'Daniel Kahneman',
     'A Nobel laureate explains the two systems that drive how we think, judge, and decide.',
     '9780374533557', 499, 'https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Homo Deus', 'Yuval Noah Harari',
     'A look at what might come next for humanity, from the author of Sapiens.',
     '9780062464316', 549, 'https://covers.openlibrary.org/b/isbn/9780062464316-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Man''s Search for Meaning', 'Viktor E. Frankl',
     'A psychiatrist''s account of surviving the Holocaust, and what it taught him about purpose.',
     '9780807014295', 299, 'https://covers.openlibrary.org/b/isbn/9780807014295-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('The Subtle Art of Not Giving a F*ck', 'Mark Manson',
     'A counterintuitive case for caring about fewer things, and caring about them more deeply.',
     '9780062457714', 399, 'https://covers.openlibrary.org/b/isbn/9780062457714-L.jpg',
     (SELECT id FROM categories WHERE slug = 'self-help'), false),

    ('The 7 Habits of Highly Effective People', 'Stephen R. Covey',
     'A classic framework for personal and professional effectiveness, built habit by habit.',
     '9780743269513', 449, 'https://covers.openlibrary.org/b/isbn/9780743269513-L.jpg',
     (SELECT id FROM categories WHERE slug = 'self-help'), false),

    ('Can''t Hurt Me', 'David Goggins',
     'A memoir on mastering mindset and pushing past perceived limits.',
     '9781544512280', 449, 'https://covers.openlibrary.org/b/isbn/9781544512280-L.jpg',
     (SELECT id FROM categories WHERE slug = 'self-help'), false),

    ('Guns, Germs, and Steel', 'Jared Diamond',
     'A sweeping account of why history unfolded so differently across continents.',
     '9780393317558', 499, 'https://covers.openlibrary.org/b/isbn/9780393317558-L.jpg',
     (SELECT id FROM categories WHERE slug = 'history'), false),

    ('A Short History of Nearly Everything', 'Bill Bryson',
     'A wry, accessible tour through science, from the Big Bang to the rise of civilization.',
     '9780767908184', 449, 'https://covers.openlibrary.org/b/isbn/9780767908184-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('Cosmos', 'Carl Sagan',
     'A beloved journey through the universe, and humanity''s place within it.',
     '9780345539434', 399, 'https://covers.openlibrary.org/b/isbn/9780345539434-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('Zero to One', 'Peter Thiel',
     'Notes on startups, and how to build something genuinely new.',
     '9780804139298', 399, 'https://covers.openlibrary.org/b/isbn/9780804139298-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('The Lean Startup', 'Eric Ries',
     'A methodology for building businesses through rapid experimentation and validated learning.',
     '9780307887894', 449, 'https://covers.openlibrary.org/b/isbn/9780307887894-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('Good to Great', 'Jim Collins',
     'Research into why some companies make the leap from good performance to lasting greatness.',
     '9780066620992', 499, 'https://covers.openlibrary.org/b/isbn/9780066620992-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('The Fault in Our Stars', 'John Green',
     'Two teenagers who meet at a cancer support group fall in love on their own terms.',
     '9780525478812', 349, 'https://covers.openlibrary.org/b/isbn/9780525478812-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), false)
ON CONFLICT (isbn) DO NOTHING;

-- Inventory for the new titles
INSERT INTO inventory (book_id, quantity)
SELECT id, qty FROM (VALUES
    ('To Kill a Mockingbird', 12),
    ('Brave New World', 10),
    ('The Catcher in the Rye', 8),
    ('Little Women', 7),
    ('The Da Vinci Code', 14),
    ('The Girl with the Dragon Tattoo', 9),
    ('The Shining', 6),
    ('And Then There Were None', 11),
    ('The Fellowship of the Ring', 10),
    ('Harry Potter and the Chamber of Secrets', 15),
    ('A Game of Thrones', 8),
    ('The Night Circus', 5),
    ('Thinking, Fast and Slow', 9),
    ('Homo Deus', 7),
    ('Man''s Search for Meaning', 13),
    ('The Subtle Art of Not Giving a F*ck', 12),
    ('The 7 Habits of Highly Effective People', 9),
    ('Can''t Hurt Me', 8),
    ('Guns, Germs, and Steel', 6),
    ('A Short History of Nearly Everything', 10),
    ('Cosmos', 7),
    ('Zero to One', 11),
    ('The Lean Startup', 9),
    ('Good to Great', 6),
    ('The Fault in Our Stars', 14)
) AS seed_qty(title, qty)
JOIN books ON books.title = seed_qty.title
ON CONFLICT (book_id) DO NOTHING;
