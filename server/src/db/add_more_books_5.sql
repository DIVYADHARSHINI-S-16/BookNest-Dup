-- Author-based catalog: turns 20 of the 40 titles from add_more_books_4.sql into additional books by
-- authors already in the catalog (different titles), so searching an author name shows several books.
-- Total stays at 105 books / 7 pages of 15. Rows are updated in place (matched by the old ISBN), so
-- ids, inventory, store listings and carts stay valid. Safe to re-run: once converted, the old ISBN no longer matches.


UPDATE books SET title = 'Charlie and the Chocolate Factory', author = 'Roald Dahl',
    description = 'Charlie Bucket wins a golden ticket and a tour of Willy Wonka''s wonderfully strange chocolate factory.',
    isbn = '9780142410318', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780142410318-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'children')
WHERE isbn = '9780060254926';

UPDATE books SET title = 'Harry Potter and the Prisoner of Azkaban', author = 'J.K. Rowling',
    description = 'Harry''s third year at Hogwarts brings a notorious escaped prisoner and the truth about his parents'' past.',
    isbn = '9780747542155', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780747542155-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'fantasy')
WHERE isbn = '9780156012195';

UPDATE books SET title = 'The Two Towers', author = 'J.R.R. Tolkien',
    description = 'The Fellowship is broken, and the war for Middle-earth begins in earnest across Rohan and Gondor.',
    isbn = '9780547928203', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780547928203-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'fantasy')
WHERE isbn = '9780064404990';

UPDATE books SET title = 'The Return of the King', author = 'J.R.R. Tolkien',
    description = 'The final chapter of the Lord of the Rings, as Frodo nears Mount Doom and Aragorn claims his destiny.',
    isbn = '9780547928197', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780547928197-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'fantasy')
WHERE isbn = '9780441013593';

UPDATE books SET title = 'Dark Places', author = 'Gillian Flynn',
    description = 'Libby Day survived the massacre of her family as a child, and now must face what she thought she knew.',
    isbn = '9780307341570', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780307341570-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'mystery')
WHERE isbn = '9780380730407';

UPDATE books SET title = 'Angels & Demons', author = 'Dan Brown',
    description = 'Robert Langdon races across Rome to stop an ancient secret society from destroying the Vatican.',
    isbn = '9781416524793', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781416524793-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'mystery')
WHERE isbn = '9780143113492';

UPDATE books SET title = 'Misery', author = 'Stephen King',
    description = 'A novelist is rescued from a car crash by his self-proclaimed number one fan, and she won''t let him leave.',
    isbn = '9781501143106', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781501143106-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'mystery')
WHERE isbn = '9780141439686';

UPDATE books SET title = 'Sense and Sensibility', author = 'Jane Austen',
    description = 'Two sisters, one ruled by sense and one by feeling, navigate love and loss in Regency England.',
    isbn = '9780141439662', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780141439662-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'romance')
WHERE isbn = '9781984822178';

UPDATE books SET title = 'The Clean Coder', author = 'Robert C. Martin',
    description = 'A professional''s guide to estimating, testing, saying no, and taking real responsibility for your code.',
    isbn = '9780137081073', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780137081073-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'technology')
WHERE isbn = '9780134757599';

UPDATE books SET title = 'Leaders Eat Last', author = 'Simon Sinek',
    description = 'Why some teams pull together and others don''t, and what great leaders do to build trust.',
    isbn = '9781591848011', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781591848011-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'business')
WHERE isbn = '9780062273208';

UPDATE books SET title = 'Digital Minimalism', author = 'Cal Newport',
    description = 'A practical philosophy for taking back your time and attention from noisy technology.',
    isbn = '9780525536512', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780525536512-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'non-fiction')
WHERE isbn = '9780345472328';

UPDATE books SET title = 'So Good They Can''t Ignore You', author = 'Cal Newport',
    description = 'Why following your passion is bad advice, and how building rare skills leads to work you love.',
    isbn = '9781455509126', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781455509126-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'non-fiction')
WHERE isbn = '9781878424310';

UPDATE books SET title = 'The Tipping Point', author = 'Malcolm Gladwell',
    description = 'How little things can make a big difference, and how ideas spread like epidemics.',
    isbn = '9780316346627', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780316346627-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'non-fiction')
WHERE isbn = '9780307352156';

UPDATE books SET title = 'Blink', author = 'Malcolm Gladwell',
    description = 'The power of thinking without thinking, and how snap judgments can be both brilliant and flawed.',
    isbn = '9780316010665', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780316010665-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'non-fiction')
WHERE isbn = '9781501111112';

UPDATE books SET title = 'Leonardo da Vinci', author = 'Walter Isaacson',
    description = 'The life and mind of history''s most creative genius, drawn from his thousands of notebook pages.',
    isbn = '9781501139154', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781501139154-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'biography')
WHERE isbn = '9780062301239';

UPDATE books SET title = 'The Universe in a Nutshell', author = 'Stephen Hawking',
    description = 'A beautifully illustrated tour of relativity, quantum theory, and the nature of space and time.',
    isbn = '9780553802023', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780553802023-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'science')
WHERE isbn = '9780198788607';

UPDATE books SET title = 'Pale Blue Dot', author = 'Carl Sagan',
    description = 'A reflection on humanity''s place in the cosmos, inspired by a single photograph of Earth from space.',
    isbn = '9780345376596', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780345376596-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'science')
WHERE isbn = '9780393609394';

UPDATE books SET title = '21 Lessons for the 21st Century', author = 'Yuval Noah Harari',
    description = 'Clear thinking on technology, work, truth, and meaning in a rapidly changing world.',
    isbn = '9780525512172', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780525512172-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'non-fiction')
WHERE isbn = '9781631491252';

UPDATE books SET title = 'A Thousand Splendid Suns', author = 'Khaled Hosseini',
    description = 'Two Afghan women from different generations form an unlikely bond through decades of war and loss.',
    isbn = '9781594483851', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9781594483851-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'fiction')
WHERE isbn = '9781501110368';

UPDATE books SET title = 'Catching Fire', author = 'Suzanne Collins',
    description = 'Katniss and Peeta return to the arena in the second book of the Hunger Games trilogy.',
    isbn = '9780439023498', cover_image_url = 'https://covers.openlibrary.org/b/isbn/9780439023498-L.jpg',
    category_id = (SELECT id FROM categories WHERE slug = 'fantasy')
WHERE isbn = '9780062407801';