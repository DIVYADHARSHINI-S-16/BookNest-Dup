-- 20 more catalog titles, on top of seed.sql + add_more_books.sql + add_more_books_2.sql.
-- Reuses existing categories only. Purely additive: no existing rows touched.

INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
VALUES
    ('The Kite Runner', 'Khaled Hosseini',
     'A boy''s childhood betrayal in Kabul haunts him for decades, until a chance to make it right arrives.',
     '9781594631931', 399, 'https://covers.openlibrary.org/b/isbn/9781594631931-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('Life of Pi', 'Yann Martel',
     'A shipwrecked boy shares a lifeboat with a Bengal tiger, and the line between survival and story blurs.',
     '9780156027328', 349, 'https://covers.openlibrary.org/b/isbn/9780156027328-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('The Book Thief', 'Markus Zusak',
     'Narrated by Death itself, the story of a girl who steals books in Nazi Germany and the family that hides a secret.',
     '9780375842207', 399, 'https://covers.openlibrary.org/b/isbn/9780375842207-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('One Hundred Years of Solitude', 'Gabriel Garcia Marquez',
     'Seven generations of a family in a mythical town live out a sweeping, magical history.',
     '9780060883287', 449, 'https://covers.openlibrary.org/b/isbn/9780060883287-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fiction'), false),

    ('Gone with the Wind', 'Margaret Mitchell',
     'A headstrong Southern woman navigates love and survival through the American Civil War and its aftermath.',
     '9781451635621', 549, 'https://covers.openlibrary.org/b/isbn/9781451635621-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), false),

    ('Outlander', 'Diana Gabaldon',
     'A former combat nurse is swept back in time to 18th-century Scotland, and into a love she never expected.',
     '9780440212560', 449, 'https://covers.openlibrary.org/b/isbn/9780440212560-L.jpg',
     (SELECT id FROM categories WHERE slug = 'romance'), false),

    ('The Hunger Games', 'Suzanne Collins',
     'A girl volunteers to fight to the death in a televised arena to save her sister.',
     '9780439023528', 399, 'https://covers.openlibrary.org/b/isbn/9780439023528-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Eragon', 'Christopher Paolini',
     'A farm boy finds a dragon egg and is swept into a destiny of magic, war, and ancient riders.',
     '9780375826689', 349, 'https://covers.openlibrary.org/b/isbn/9780375826689-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('The Name of the Wind', 'Patrick Rothfuss',
     'A legendary figure recounts his own extraordinary and dangerous past, one day at a time.',
     '9780756404079', 499, 'https://covers.openlibrary.org/b/isbn/9780756404079-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('Mistborn: The Final Empire', 'Brandon Sanderson',
     'A street thief with rare powers is recruited into a plot to overthrow an immortal emperor.',
     '9780765311788', 499, 'https://covers.openlibrary.org/b/isbn/9780765311788-L.jpg',
     (SELECT id FROM categories WHERE slug = 'fantasy'), false),

    ('The Girl on the Train', 'Paula Hawkins',
     'A woman''s daily train ride past a couple''s house pulls her into a disappearance she can''t look away from.',
     '9781594634024', 349, 'https://covers.openlibrary.org/b/isbn/9781594634024-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('Sharp Objects', 'Gillian Flynn',
     'A journalist returns to her hometown to cover a murder, and confronts the family she left behind.',
     '9780307341556', 349, 'https://covers.openlibrary.org/b/isbn/9780307341556-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('Big Little Lies', 'Liane Moriarty',
     'Three mothers'' lives collide around a school fundraiser, and a secret that ends in tragedy.',
     '9780425274866', 399, 'https://covers.openlibrary.org/b/isbn/9780425274866-L.jpg',
     (SELECT id FROM categories WHERE slug = 'mystery'), false),

    ('The Immortal Life of Henrietta Lacks', 'Rebecca Skloot',
     'The true story of the cells taken without consent from a poor Black woman that went on to transform medicine.',
     '9781400052189', 399, 'https://covers.openlibrary.org/b/isbn/9781400052189-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Outliers', 'Malcolm Gladwell',
     'An investigation into what really separates extraordinary success from the ordinary.',
     '9780316017930', 349, 'https://covers.openlibrary.org/b/isbn/9780316017930-L.jpg',
     (SELECT id FROM categories WHERE slug = 'non-fiction'), false),

    ('Into the Wild', 'Jon Krakauer',
     'The true story of a young man who gave away his savings and walked into the Alaskan wilderness alone.',
     '9780385486804', 349, 'https://covers.openlibrary.org/b/isbn/9780385486804-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('The Diary of a Young Girl', 'Anne Frank',
     'The diary kept by a Jewish teenager in hiding during the Nazi occupation of the Netherlands.',
     '9780553296983', 299, 'https://covers.openlibrary.org/b/isbn/9780553296983-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('Steve Jobs', 'Walter Isaacson',
     'The definitive biography of Apple''s co-founder, built from years of exclusive access and interviews.',
     '9781451648539', 549, 'https://covers.openlibrary.org/b/isbn/9781451648539-L.jpg',
     (SELECT id FROM categories WHERE slug = 'biography'), false),

    ('The Pragmatic Programmer', 'David Thomas & Andrew Hunt',
     'Practical, timeless advice for becoming a better software developer, one habit at a time.',
     '9780135957059', 599, 'https://covers.openlibrary.org/b/isbn/9780135957059-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false),

    ('Introduction to Algorithms', 'Thomas H. Cormen',
     'A comprehensive, rigorous textbook covering the design and analysis of computer algorithms.',
     '9780262033848', 899, 'https://covers.openlibrary.org/b/isbn/9780262033848-L.jpg',
     (SELECT id FROM categories WHERE slug = 'technology'), false)
ON CONFLICT (isbn) DO NOTHING;

-- Inventory for the new titles
INSERT INTO inventory (book_id, quantity)
SELECT id, qty FROM (VALUES
    ('The Kite Runner', 11),
    ('Life of Pi', 9),
    ('The Book Thief', 8),
    ('One Hundred Years of Solitude', 6),
    ('Gone with the Wind', 7),
    ('Outlander', 10),
    ('The Hunger Games', 15),
    ('Eragon', 9),
    ('The Name of the Wind', 7),
    ('Mistborn: The Final Empire', 8),
    ('The Girl on the Train', 12),
    ('Sharp Objects', 9),
    ('Big Little Lies', 10),
    ('The Immortal Life of Henrietta Lacks', 6),
    ('Outliers', 10),
    ('Into the Wild', 8),
    ('The Diary of a Young Girl', 9),
    ('Steve Jobs', 7),
    ('The Pragmatic Programmer', 6),
    ('Introduction to Algorithms', 5)
) AS seed_qty(title, qty)
JOIN books ON books.title = seed_qty.title
ON CONFLICT (book_id) DO NOTHING;