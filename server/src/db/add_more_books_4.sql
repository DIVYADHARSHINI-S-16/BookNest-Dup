-- 40 more catalog titles (65 -> 105 books), including extra titles by authors already in the catalog,
-- so an author search returns several books. Reuses existing categories only.
-- Safe to re-run: books are keyed by ISBN (ON CONFLICT DO NOTHING) and nothing here modifies existing rows.

INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
VALUES
    ('A People''s History of the United States', 'Howard Zinn',
     'American history retold from the perspective of workers, women, immigrants, and the people usually left out of textbooks.',
     '9780062397348', 549, 'https://covers.openlibrary.org/b/isbn/9780062397348-L.jpg',
     (SELECT id FROM categories WHERE slug = 'history'), false),

    ('21 Lessons for the 21st Century', 'Yuval Noah Harari',
     'Clear thinking on technology, work, truth, and meaning in a rapidly changing world.',
     '9780525512172', 499, 'https://covers.openlibrary.org/b/isbn/9780525512172-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('India After Gandhi', 'Ramachandra Guha',
     'The story of the world''s largest democracy and how it survived against the odds after independence.',
     '9780060958589', 599, 'https://covers.openlibrary.org/b/isbn/9780060958589-L.jpg',
     (SELECT id FROM categories WHERE slug = 'history'), false),

    ('The Silk Roads', 'Peter Frankopan',
     'A new history of the world told through the trade routes that linked East and West.',
     '9781101912379', 449, 'https://covers.openlibrary.org/b/isbn/9781101912379-L.jpg',
     (SELECT id FROM categories WHERE slug = 'history'), false),

    ('A Brief History of Time', 'Stephen Hawking',
     'From the Big Bang to black holes, a landmark guide to the universe for general readers.',
     '9780553380163', 349, 'https://covers.openlibrary.org/b/isbn/9780553380163-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('The Universe in a Nutshell', 'Stephen Hawking',
     'A beautifully illustrated tour of relativity, quantum theory, and the nature of space and time.',
     '9780553802023', 449, 'https://covers.openlibrary.org/b/isbn/9780553802023-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('Pale Blue Dot', 'Carl Sagan',
     'A reflection on humanity''s place in the cosmos, inspired by a single photograph of Earth from space.',
     '9780345376596', 299, 'https://covers.openlibrary.org/b/isbn/9780345376596-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('The Gene: An Intimate History', 'Siddhartha Mukherjee',
     'The epic story of the gene, from Mendel''s garden to modern genetic engineering.',
     '9781476733524', 499, 'https://covers.openlibrary.org/b/isbn/9781476733524-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('The Emperor of All Maladies', 'Siddhartha Mukherjee',
     'A biography of cancer, tracing humanity''s long struggle to understand and treat it.',
     '9781439170915', 549, 'https://covers.openlibrary.org/b/isbn/9781439170915-L.jpg',
     (SELECT id FROM categories WHERE slug = 'science'), false),

    ('Clean Architecture', 'Robert C. Martin',
     'A practical guide to structuring software so it stays flexible, testable, and independent of frameworks.',
     '9780134494166', 699, 'https://covers.openlibrary.org/b/isbn/9780134494166-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('Designing Data-Intensive Applications', 'Martin Kleppmann',
     'The big ideas behind reliable, scalable, and maintainable data systems.',
     '9781449373320', 899, 'https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('Effective Java', 'Joshua Bloch',
     'Time-tested best practices for writing clear, correct, and robust Java code.',
     '9780134685991', 799, 'https://covers.openlibrary.org/b/isbn/9780134685991-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('Head First Design Patterns', 'Eric Freeman, Elisabeth Robson',
     'A visual, hands-on introduction to object-oriented design patterns.',
     '9781492078005', 749, 'https://covers.openlibrary.org/b/isbn/9781492078005-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('Cracking the Coding Interview', 'Gayle Laakmann McDowell',
     '189 programming questions and solutions, plus the strategy to land a software engineering role.',
     '9780984782857', 699, 'https://covers.openlibrary.org/b/isbn/9780984782857-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('The Clean Coder', 'Robert C. Martin',
     'A professional''s guide to estimating, testing, saying no, and taking real responsibility for your code.',
     '9780137081073', 799, 'https://covers.openlibrary.org/b/isbn/9780137081073-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('The Intelligent Investor', 'Benjamin Graham',
     'The classic guide to value investing and keeping emotion out of your money decisions.',
     '9780060555665', 499, 'https://covers.openlibrary.org/b/isbn/9780060555665-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('Start with Why', 'Simon Sinek',
     'How great leaders inspire action by starting with purpose before products.',
     '9781591846444', 399, 'https://covers.openlibrary.org/b/isbn/9781591846444-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('Catching Fire', 'Suzanne Collins',
     'Katniss and Peeta return to the arena in the second book of the Hunger Games trilogy.',
     '9780439023498', 449, 'https://covers.openlibrary.org/b/isbn/9780439023498-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Leaders Eat Last', 'Simon Sinek',
     'Why some teams pull together and others don''t, and what great leaders do to build trust.',
     '9781591848011', 449, 'https://covers.openlibrary.org/b/isbn/9781591848011-L.jpg',
     (SELECT id FROM categories WHERE slug = 'business'), false),

    ('The Power of Habit', 'Charles Duhigg',
     'Why habits form, how they shape our lives, and how to change them.',
     '9780812981605', 399, 'https://covers.openlibrary.org/b/isbn/9780812981605-L.jpg',
     (SELECT id FROM categories WHERE slug = 'self-help'), false),

    ('Digital Minimalism', 'Cal Newport',
     'A practical philosophy for taking back your time and attention from noisy technology.',
     '9780525536512', 349, 'https://covers.openlibrary.org/b/isbn/9780525536512-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('How to Win Friends and Influence People', 'Dale Carnegie',
     'Timeless principles for building relationships, communicating well, and influencing others.',
     '9781982171452', 299, 'https://covers.openlibrary.org/b/isbn/9781982171452-L.jpg',
     (SELECT id FROM categories WHERE slug = 'self-help'), false),

    ('So Good They Can''t Ignore You', 'Cal Newport',
     'Why following your passion is bad advice, and how building rare skills leads to work you love.',
     '9781455509126', 249, 'https://covers.openlibrary.org/b/isbn/9781455509126-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('The Tipping Point', 'Malcolm Gladwell',
     'How little things can make a big difference, and how ideas spread like epidemics.',
     '9780316346627', 399, 'https://covers.openlibrary.org/b/isbn/9780316346627-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Blink', 'Malcolm Gladwell',
     'The power of thinking without thinking, and how snap judgments can be both brilliant and flawed.',
     '9780316010665', 399, 'https://covers.openlibrary.org/b/isbn/9780316010665-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Long Walk to Freedom', 'Nelson Mandela',
     'The autobiography of Nelson Mandela, from a village childhood to the presidency of South Africa.',
     '9780316548182', 499, 'https://covers.openlibrary.org/b/isbn/9780316548182-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('Wings of Fire', 'A.P.J. Abdul Kalam',
     'The inspiring life story of India''s Missile Man and former President.',
     '9788173711466', 299, 'https://covers.openlibrary.org/b/isbn/9788173711466-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('Leonardo da Vinci', 'Walter Isaacson',
     'The life and mind of history''s most creative genius, drawn from his thousands of notebook pages.',
     '9781501139154', 449, 'https://covers.openlibrary.org/b/isbn/9781501139154-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('Harry Potter and the Prisoner of Azkaban', 'J.K. Rowling',
     'Harry''s third year at Hogwarts brings a notorious escaped prisoner and the truth about his parents'' past.',
     '9780747542155', 249, 'https://covers.openlibrary.org/b/isbn/9780747542155-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Matilda', 'Roald Dahl',
     'A brilliant girl with a love of books uses her wits and special powers against bullying grown-ups.',
     '9780142410370', 299, 'https://covers.openlibrary.org/b/isbn/9780142410370-L.jpg',
     (SELECT id FROM categories WHERE slug = 'children'), false),

    ('Charlie and the Chocolate Factory', 'Roald Dahl',
     'Charlie Bucket wins a golden ticket and a tour of Willy Wonka''s wonderfully strange chocolate factory.',
     '9780142410318', 349, 'https://covers.openlibrary.org/b/isbn/9780142410318-L.jpg',
     (SELECT id FROM categories WHERE slug = 'children'), false),

    ('Misery', 'Stephen King',
     'A novelist is rescued from a car crash by his self-proclaimed number one fan, and she won''t let him leave.',
     '9781501143106', 199, 'https://covers.openlibrary.org/b/isbn/9781501143106-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('A Thousand Splendid Suns', 'Khaled Hosseini',
     'Two Afghan women from different generations form an unlikely bond through decades of war and loss.',
     '9781594483851', 349, 'https://covers.openlibrary.org/b/isbn/9781594483851-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('Sense and Sensibility', 'Jane Austen',
     'Two sisters, one ruled by sense and one by feeling, navigate love and loss in Regency England.',
     '9780141439662', 399, 'https://covers.openlibrary.org/b/isbn/9780141439662-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), false),

    ('The Two Towers', 'J.R.R. Tolkien',
     'The Fellowship is broken, and the war for Middle-earth begins in earnest across Rohan and Gondor.',
     '9780547928203', 299, 'https://covers.openlibrary.org/b/isbn/9780547928203-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('The Way of Kings', 'Brandon Sanderson',
     'The first book of the Stormlight Archive, an epic of war, honour, and ancient magic.',
     '9780765326355', 599, 'https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('The Return of the King', 'J.R.R. Tolkien',
     'The final chapter of the Lord of the Rings, as Frodo nears Mount Doom and Aragorn claims his destiny.',
     '9780547928197', 449, 'https://covers.openlibrary.org/b/isbn/9780547928197-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Murder on the Orient Express', 'Agatha Christie',
     'Hercule Poirot investigates a murder aboard a snowbound train full of suspects.',
     '9780062693662', 299, 'https://covers.openlibrary.org/b/isbn/9780062693662-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('Angels & Demons', 'Dan Brown',
     'Robert Langdon races across Rome to stop an ancient secret society from destroying the Vatican.',
     '9781416524793', 399, 'https://covers.openlibrary.org/b/isbn/9781416524793-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('Dark Places', 'Gillian Flynn',
     'Libby Day survived the massacre of her family as a child, and now must face what she thought she knew.',
     '9780307341570', 349, 'https://covers.openlibrary.org/b/isbn/9780307341570-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false)
ON CONFLICT (isbn) DO NOTHING;

-- Inventory for the new titles
INSERT INTO inventory (book_id, quantity)
SELECT id, qty FROM (VALUES
    ('A People''s History of the United States', 6),
    ('21 Lessons for the 21st Century', 7),
    ('India After Gandhi', 6),
    ('The Silk Roads', 8),
    ('A Brief History of Time', 12),
    ('The Universe in a Nutshell', 8),
    ('Pale Blue Dot', 14),
    ('The Gene: An Intimate History', 7),
    ('The Emperor of All Maladies', 6),
    ('Clean Architecture', 7),
    ('Designing Data-Intensive Applications', 6),
    ('Effective Java', 9),
    ('Head First Design Patterns', 8),
    ('Cracking the Coding Interview', 15),
    ('The Clean Coder', 5),
    ('The Intelligent Investor', 9),
    ('Start with Why', 11),
    ('Catching Fire', 10),
    ('Leaders Eat Last', 7),
    ('The Power of Habit', 12),
    ('Digital Minimalism', 10),
    ('How to Win Friends and Influence People', 16),
    ('So Good They Can''t Ignore You', 13),
    ('The Tipping Point', 8),
    ('Blink', 9),
    ('Long Walk to Freedom', 7),
    ('Wings of Fire', 18),
    ('Leonardo da Vinci', 8),
    ('Harry Potter and the Prisoner of Azkaban', 14),
    ('Matilda', 12),
    ('Charlie and the Chocolate Factory', 10),
    ('Misery', 9),
    ('A Thousand Splendid Suns', 15),
    ('Sense and Sensibility', 8),
    ('The Two Towers', 13),
    ('The Way of Kings', 6),
    ('The Return of the King', 11),
    ('Murder on the Orient Express', 14),
    ('Angels & Demons', 7),
    ('Dark Places', 9)
) AS seed_qty(title, qty)
JOIN books ON books.title = seed_qty.title
ON CONFLICT (book_id) DO NOTHING;