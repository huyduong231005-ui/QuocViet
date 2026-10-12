# Demo fixtures and deferred evaluation corpus

`demo-quotation.txt` and `demo-quotation.pdf` are synthetic quotations for manually
trying the extraction screen: 15 units, VND 68,000 per unit, 3 delivery days, 8% VAT,
valid until 2099-12-31. No quality score is supplied; a user must enter one from an
appropriate evaluation source. Generate the PDF with `../generate_demo.py`.
These two files are demo inputs, not training data or an accuracy benchmark.

The next stage will add 30 labeled synthetic samples: 10 text emails, 10 PDF
quotations (including one scanned PDF), and 10 images, plus a reproducible
generation script and evaluation report. Report actual per-format field accuracy;
OCR-unavailable samples must be marked unavailable rather than counted as passed.
These fixtures cannot establish accuracy on real supplier documents.
