-- 12 second-hand titles, each with a condition record and a small stock (1-3 copies).
-- Titles are deliberately NOT in the new-book catalog so fix_prices.sql / fix_covers.sql
-- (which update by title) never touch them. books.price holds the price the customer pays.
-- Safe to re-run: books skip on duplicate ISBN; condition and inventory rows skip if present.
-- Requires migrations_phase1e.sql (unique index on second_hand_conditions.book_id).

INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
VALUES
    ('Animal Farm', 'George Orwell',
     'A farmyard rebellion curdles into tyranny in Orwell''s short, sharp political fable.',
     '9780451526342', 119, 'https://covers.openlibrary.org/b/isbn/9780451526342-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Jane Eyre', 'Charlotte Bronte',
     'An orphaned governess finds love, mystery and fierce independence at Thornfield Hall.',
     '9780141441146', 149, 'https://covers.openlibrary.org/b/isbn/9780141441146-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), true),

    ('The God of Small Things', 'Arundhati Roy',
     'A Kerala family''s tangled past unravels around one fateful season, told in lush, shifting time.',
     '9780812979657', 229, 'https://covers.openlibrary.org/b/isbn/9780812979657-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Wuthering Heights', 'Emily Bronte',
     'A savage, haunting love story across two generations on the Yorkshire moors.',
     '9780141439556', 129, 'https://covers.openlibrary.org/b/isbn/9780141439556-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), true),

    ('Dune', 'Frank Herbert',
     'On the desert planet Arrakis, a young heir is drawn into a war over the most valuable substance in the universe.',
     '9780441172719', 279, 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), true),

    ('Midnight''s Children', 'Salman Rushdie',
     'Born at the stroke of India''s independence, Saleem Sinai''s life mirrors the nation''s own turbulent story.',
     '9780812976533', 249, 'https://covers.openlibrary.org/b/isbn/9780812976533-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('The Old Man and the Sea', 'Ernest Hemingway',
     'An aging Cuban fisherman''s epic struggle with a giant marlin becomes a parable of endurance.',
     '9780684801223', 99, 'https://covers.openlibrary.org/b/isbn/9780684801223-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Of Mice and Men', 'John Steinbeck',
     'Two migrant workers chase a small dream of land and security in Depression-era California.',
     '9780140177398', 89, 'https://covers.openlibrary.org/b/isbn/9780140177398-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Frankenstein', 'Mary Shelley',
     'A young scientist''s act of creation unleashes consequences he cannot escape.',
     '9780486282114', 79, 'https://covers.openlibrary.org/b/isbn/9780486282114-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('The Picture of Dorian Gray', 'Oscar Wilde',
     'A beautiful young man stays unchanged while his portrait absorbs the cost of his vanity.',
     '9780141442464', 129, 'https://covers.openlibrary.org/b/isbn/9780141442464-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Lord of the Flies', 'William Golding',
     'Stranded schoolboys build a society on an island, and watch it unravel into savagery.',
     '9780399501487', 119, 'https://covers.openlibrary.org/b/isbn/9780399501487-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true),

    ('Fahrenheit 451', 'Ray Bradbury',
     'In a future where books are burned, a fireman begins to question his work.',
     '9781451673319', 169, 'https://covers.openlibrary.org/b/isbn/9781451673319-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), true)
ON CONFLICT (isbn) DO NOTHING;

INSERT INTO second_hand_conditions (book_id, condition_grade, condition_notes, cover_condition, page_condition, visible_wear, additional_notes)
SELECT b.id, v.grade, v.notes, v.cover, v.pages, v.wear, v.extra FROM (VALUES
    ('9780451526342', 'GOOD', 'Previous owner''s name on the first page.', 'Soft cover with light creasing at the spine', 'Pages clean and unmarked, slightly yellowed', 'Minor corner bumps', 'Previous owner''s name on the first page.'),
    ('9780141441146', 'VERY_GOOD', 'Handled gently; looks barely read.', 'Glossy cover, no tears', 'Clean pages, no highlighting', 'Very light shelf wear', 'Handled gently; looks barely read.'),
    ('9780812979657', 'LIKE_NEW', 'Read once and stored upright.', 'Cover as good as new', 'Crisp pages, no marks', 'None visible', 'Read once and stored upright.'),
    ('9780141439556', 'GOOD', 'Classic Penguin edition with minor age toning.', 'Slightly rubbed cover edges', 'Pages tanned with age, no writing', 'Faint spine crease', 'Classic Penguin edition with minor age toning.'),
    ('9780441172719', 'VERY_GOOD', 'Dense, long read in good shape.', 'Cover intact, light rubbing', 'Clean pages', 'Small crease on back cover', 'Dense, long read in good shape.'),
    ('9780812976533', 'GOOD', 'Some pencil underlining in the first 60 pages.', 'Cover lightly scuffed', 'A few pencil underlines in early chapters', 'Spine slightly leaning', 'Some pencil underlining in the first 60 pages.'),
    ('9780684801223', 'VERY_GOOD', 'Short read, kept in a bookshelf.', 'Clean cover with sharp corners', 'Pages clean', 'Very light edge wear', 'Short read, kept in a bookshelf.'),
    ('9780140177398', 'ACCEPTABLE', 'Budget copy with margin notes, text fully readable.', 'Cover creased, one corner folded', 'Some pages with small margin notes', 'Visible reading wear and spine creases', 'Budget copy with margin notes, text fully readable.'),
    ('9780486282114', 'GOOD', 'Thrift-edition paperback in readable condition.', 'Plain paper cover, light fading', 'Pages slightly yellowed, no markings', 'Minor corner wear', 'Thrift-edition paperback in readable condition.'),
    ('9780141442464', 'LIKE_NEW', 'Purchased and read once.', 'Clean cover, no creases', 'Crisp, unmarked pages', 'None visible', 'Purchased and read once.'),
    ('9780399501487', 'GOOD', 'Common school-reading copy in decent shape.', 'Cover slightly worn at the edges', 'Pages clean with mild aging', 'Light spine creasing', 'Common school-reading copy in decent shape.'),
    ('9781451673319', 'VERY_GOOD', 'Well-kept copy, no markings.', 'Clean cover', 'Pages clean and tight', 'Slight shelf wear', 'Well-kept copy, no markings.')
) AS v(isbn, grade, notes, cover, pages, wear, extra)
JOIN books b ON b.isbn = v.isbn
ON CONFLICT (book_id) DO NOTHING;

INSERT INTO inventory (book_id, quantity)
SELECT b.id, v.qty FROM (VALUES
    ('9780451526342', 2),
    ('9780141441146', 1),
    ('9780812979657', 1),
    ('9780141439556', 2),
    ('9780441172719', 1),
    ('9780812976533', 1),
    ('9780684801223', 2),
    ('9780140177398', 2),
    ('9780486282114', 3),
    ('9780141442464', 1),
    ('9780399501487', 2),
    ('9781451673319', 1)
) AS v(isbn, qty)
JOIN books b ON b.isbn = v.isbn
ON CONFLICT (book_id) DO NOTHING;
