"""Create one readable PDF for manual quotation-extraction testing, not a training corpus."""
from pathlib import Path
from reportlab.pdfgen import canvas

def generate_pdf(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(path))
    pdf.setTitle("ProcureIQ quotation extraction demo")
    lines = ["DEMO QUOTATION - synthetic data for testing only", "Product: A4 paper",
             "Quantity: 15", "Unit price: 68000 VND", "Delivery: 3 days",
             "VAT: 8%", "Valid until: 2099-12-31",
             "Quality score is not provided; a person must review and complete it."]
    for index, line in enumerate(lines):
        pdf.drawString(40, 780-index*28, line)
    pdf.save()

if __name__ == "__main__":
    destination = Path(__file__).parent / "fixtures" / "demo-quotation.pdf"
    generate_pdf(destination)
    print(f"Demo PDF written: {destination.name}")
