from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(r"C:/Users/Usuario/Documents/Desarrollos/Honda Fest Chile")
SCREENSHOTS = Path(r"C:/Users/Usuario/Downloads/mercadopago-configuracion-2026-09-01")
OUTPUT = Path(r"C:/Users/Usuario/Downloads/Guia-configuracion-Mercado-Pago-Honda-Fest-Chile.pdf")

PAGE_W, PAGE_H = A4
MARGIN_X = 1.7 * cm

INK = colors.HexColor("#15171A")
MUTED = colors.HexColor("#56616F")
RED = colors.HexColor("#E21B23")
DEEP_GREEN = colors.HexColor("#173F3A")
GOLD = colors.HexColor("#E7B63A")
PAPER = colors.HexColor("#F7F8F6")
SOFT_GREEN = colors.HexColor("#F0F6F3")
SOFT_RED = colors.HexColor("#FFF2F2")
LINE = colors.HexColor("#D9DFD9")


def fit_image(path: Path, max_width: float, max_height: float) -> Image:
    image = Image(str(path))
    scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    return image


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN_X, 1.15 * cm, PAGE_W - MARGIN_X, 1.15 * cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 0.72 * cm, "Honda Fest Chile | Configuracion Mercado Pago")
    canvas.drawRightString(PAGE_W - MARGIN_X, 0.72 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="Eyebrow",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=GOLD,
        spaceAfter=9,
        uppercase=True,
    )
)
styles.add(
    ParagraphStyle(
        name="TitleHfc",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=29,
        leading=34,
        textColor=colors.white,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="LeadHfc",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=13,
        leading=19,
        textColor=colors.HexColor("#E4E9E5"),
    )
)
styles.add(
    ParagraphStyle(
        name="SectionHfc",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=22,
        textColor=INK,
        spaceBefore=3,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="StepTitle",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=16,
        textColor=INK,
        spaceBefore=3,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="BodyHfc",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14.5,
        textColor=INK,
        spaceAfter=7,
    )
)
styles.add(
    ParagraphStyle(
        name="SmallHfc",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.7,
        leading=12,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        name="CaptionHfc",
        parent=styles["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=8.3,
        leading=11,
        textColor=MUTED,
        spaceBefore=5,
        spaceAfter=9,
    )
)
styles.add(
    ParagraphStyle(
        name="CalloutHfc",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=14,
        textColor=DEEP_GREEN,
    )
)
styles.add(
    ParagraphStyle(
        name="CodeHfc",
        parent=styles["BodyText"],
        fontName="Courier",
        fontSize=8.3,
        leading=10.5,
        textColor=INK,
    )
)


def step(number: str, title: str, body: str):
    return KeepTogether(
        [
            Table(
                [
                    [
                        Paragraph(number, ParagraphStyle("StepNo", fontName="Helvetica-Bold", fontSize=11, textColor=colors.white, alignment=TA_LEFT)),
                        Paragraph(title, styles["StepTitle"]),
                    ],
                    ["", Paragraph(body, styles["BodyHfc"])],
                ],
                colWidths=[0.7 * cm, 15.6 * cm],
                style=TableStyle(
                    [
                        ("SPAN", (0, 0), (0, 1)),
                        ("BACKGROUND", (0, 0), (0, 1), RED),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("LEFTPADDING", (0, 0), (0, 1), 5),
                        ("TOPPADDING", (0, 0), (0, 1), 4),
                        ("BOTTOMPADDING", (0, 0), (0, 1), 4),
                        ("LEFTPADDING", (1, 0), (1, 0), 8),
                        ("RIGHTPADDING", (1, 0), (1, 0), 0),
                        ("TOPPADDING", (1, 0), (1, 0), 0),
                        ("BOTTOMPADDING", (1, 0), (1, 0), 1),
                        ("LEFTPADDING", (1, 1), (1, 1), 0),
                        ("RIGHTPADDING", (1, 1), (1, 1), 0),
                        ("TOPPADDING", (1, 1), (1, 1), 3),
                        ("BOTTOMPADDING", (1, 1), (1, 1), 8),
                    ]
                ),
            ),
        ]
    )


def callout(text: str, color=SOFT_GREEN, border=DEEP_GREEN):
    return Table(
        [[Paragraph(text, styles["CalloutHfc"])]],
        colWidths=[17.0 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("LINEBEFORE", (0, 0), (0, -1), 3, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        ),
    )


story = []

# Cover
cover = [
    Spacer(1, 0.4 * cm),
    Paragraph("HONDA FEST CHILE", styles["Eyebrow"]),
    Paragraph("Nueva empresa.<br/>Nueva cuenta Mercado Pago.", styles["TitleHfc"]),
    Paragraph(
        "Guia para que el propietario configure la cuenta correcta, active credenciales de produccion y entregue al equipo tecnico los datos necesarios para cobrar dentro de hondafestchile.cl.",
        styles["LeadHfc"],
    ),
    Spacer(1, 0.7 * cm),
]
cover.append(
    Table(
        [[Paragraph("Resultado esperado", ParagraphStyle("CoverLabel", fontName="Helvetica-Bold", fontSize=9, textColor=GOLD)), Paragraph("Pago interno con Card Payment Brick, cobros asociados al nuevo RUT y confirmacion segura mediante Webhook.", ParagraphStyle("CoverResult", fontName="Helvetica-Bold", fontSize=13, leading=18, textColor=colors.white))]],
        colWidths=[4.0 * cm, 13.0 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#102D29")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
            ]
        ),
    )
)
cover.extend(
    [
        Spacer(1, 0.6 * cm),
        Paragraph("Quien hace que", styles["SectionHfc"]),
        Table(
            [
                [Paragraph("Propietario de la nueva cuenta", styles["StepTitle"]), Paragraph("Equipo tecnico Honda Fest", styles["StepTitle"])],
                [
                    Paragraph("Valida la empresa, nuevo RUT y cuenta bancaria. Crea la aplicacion, activa produccion y configura el Webhook.", styles["BodyHfc"]),
                    Paragraph("Carga secretos en entorno seguro, despliega, verifica pagos y deja inhabilitadas las llaves anteriores.", styles["BodyHfc"]),
                ],
            ],
            colWidths=[8.45 * cm, 8.45 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), PAPER),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 11),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            ),
        ),
        Spacer(1, 0.35 * cm),
        callout("No reutilizar la cuenta ni las llaves de la empresa anterior. Un fallback con credenciales antiguas podria cobrar en el RUT equivocado.", SOFT_RED, RED),
        Spacer(1, 0.6 * cm),
        Paragraph("Documento preparado el 2 de septiembre de 2026. Las pantallas corresponden a la documentacion oficial de Mercado Pago consultada desde el navegador interno.", styles["SmallHfc"]),
    ]
)
story.append(Table([[cover]], colWidths=[17.0 * cm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), INK), ("LEFTPADDING", (0, 0), (-1, -1), 18), ("RIGHTPADDING", (0, 0), (-1, -1), 18), ("TOPPADDING", (0, 0), (-1, -1), 18), ("BOTTOMPADDING", (0, 0), (-1, -1), 18)])))
story.append(PageBreak())

# Account and app
story.extend(
    [
        Paragraph("1. Cuenta y aplicacion", styles["SectionHfc"]),
        Paragraph("El primer control evita el error mas costoso: que el cliente pague a una empresa distinta de la que debe recaudar.", styles["BodyHfc"]),
        step("1", "Validar la nueva cuenta Mercado Pago", "El propietario debe operar una cuenta nueva, registrada con la razon social y RUT nuevos. Completar los datos que Mercado Pago solicite para validar empresa, representante, correo, telefono y cuenta bancaria de retiro. La cuenta bancaria debe corresponder a la nueva entidad."),
        step("2", "Crear una aplicacion para Honda Fest Chile", "En Mercado Pago Developers, abrir <b>Tus integraciones</b> y crear una aplicacion nueva, por ejemplo <b>Honda Fest Chile Produccion</b>. Elegir <b>Checkout Bricks</b>. Es la aplicacion que habilita el pago con tarjeta dentro de www.hondafestchile.cl."),
        step("3", "No usar OAuth", "No se conecta una cuenta de un tercero ni un marketplace. En Configuracion avanzada dejar vacia la URL de redireccionamiento OAuth, mantener PKCE en <b>No</b> y no activar Application & User APIs ni CBP - Exchange Office."),
        Spacer(1, 0.15 * cm),
        fit_image(SCREENSHOTS / "01-checkout-api.png", 17.0 * cm, 8.7 * cm),
        Paragraph("Mercado Pago identifica Checkout API como pago en el sitio, sin redireccionar al comprador a una pagina externa.", styles["CaptionHfc"]),
        callout("Decision de integracion: Checkout Bricks para la interfaz de tarjeta y Payments API en el backend. Checkout Pro no debe quedar activo con credenciales de la empresa anterior."),
    ]
)
story.append(PageBreak())

# Credentials
story.extend(
    [
        Paragraph("2. Credenciales de produccion", styles["SectionHfc"]),
        Paragraph("Las credenciales de prueba sirven solo para simular. Las ventas reales requieren activar el ambiente de produccion de la aplicacion nueva.", styles["BodyHfc"]),
        step("4", "Activar credenciales de produccion", "Abrir la aplicacion creada y entrar a <b>Credenciales</b>. En la seccion de produccion, indicar la industria o rubro, registrar <b>https://www.hondafestchile.cl</b> como sitio web, aceptar la declaracion y completar el reCAPTCHA. Luego elegir <b>Activar credenciales de produccion</b>."),
        fit_image(SCREENSHOTS / "02-credenciales-produccion.png", 17.0 * cm, 9.3 * cm),
        Paragraph("Mercado Pago muestra las credenciales de prueba y de produccion por separado. Solo usar las de produccion al abrir ventas reales.", styles["CaptionHfc"]),
        step("5", "Entregar solo lo necesario por un canal seguro", "La aplicacion entrega una <b>Public Key</b> y un <b>Access Token</b>. Tambien se necesitara el secreto de firma del Webhook. El Access Token no se envia por correo, chat, WhatsApp, capturas ni queda en frontend. Se guarda como secreto en .env.local y en Vercel."),
        callout("Antes de sustituir llaves: confirmar que la nueva cuenta y el nuevo RUT aparecen en el panel de Mercado Pago. Renovar credenciales invalida las anteriores.", SOFT_RED, RED),
    ]
)
story.append(PageBreak())

# Webhooks
story.extend(
    [
        Paragraph("3. Webhook y confirmacion real", styles["SectionHfc"]),
        Paragraph("El navegador puede volver desde Mercado Pago aunque el pago haya quedado pendiente, rechazado o cancelado. La orden se marca como pagada solo despues de validar el evento de Mercado Pago.", styles["BodyHfc"]),
        step("6", "Configurar Webhooks de produccion", "En la aplicacion, abrir <b>Tus integraciones > Webhooks</b>. Agregar el evento de <b>Pagos</b> para ambiente de produccion y configurar esta URL exacta:<br/><br/><font color='#173F3A'><b>https://www.hondafestchile.cl/api/webhooks/mercadopago</b></font><br/><br/>Guardar y copiar el secreto de firma que entregue Mercado Pago."),
        fit_image(SCREENSHOTS / "03-webhooks.png", 17.0 * cm, 9.2 * cm),
        Paragraph("El panel de Webhooks permite revisar entregas exitosas o fallidas y diagnosticar eventos sin procesar.", styles["CaptionHfc"]),
        callout("El evento obligatorio es Pagos. No se habilitan entradas, correo de confirmacion ni enrolamiento solamente porque el comprador regreso al sitio.", SOFT_GREEN, DEEP_GREEN),
    ]
)
story.append(PageBreak())

# Technical handoff
story.extend(
    [
        Paragraph("4. Traspaso al equipo tecnico", styles["SectionHfc"]),
        Paragraph("Cuando el propietario complete los pasos anteriores, el equipo tecnico realiza esta parte. No requiere cambios de codigo para activar las llaves nuevas.", styles["BodyHfc"]),
        Paragraph("Variables que se cargan como secretos", styles["StepTitle"]),
        Table(
            [
                [Paragraph("Variable", styles["SmallHfc"]), Paragraph("Uso", styles["SmallHfc"])],
                [Paragraph("MERCADOPAGO_PUBLIC_KEY", styles["CodeHfc"]), Paragraph("Monta el Card Payment Brick en el checkout.", styles["BodyHfc"])],
                [Paragraph("MERCADOPAGO_ACCESS_TOKEN", styles["CodeHfc"]), Paragraph("Crea y consulta pagos solo desde el servidor.", styles["BodyHfc"])],
                [Paragraph("MERCADOPAGO_WEBHOOK_SECRET", styles["CodeHfc"]), Paragraph("Valida la firma de los eventos entrantes.", styles["BodyHfc"])],
                [Paragraph("PUBLIC_BASE_URL", styles["CodeHfc"]), Paragraph("Debe quedar en https://www.hondafestchile.cl.", styles["BodyHfc"])],
                [Paragraph("MERCADOPAGO_INTERNAL_CHECKOUT", styles["CodeHfc"]), Paragraph("Se establece en true para usar pago interno.", styles["BodyHfc"])],
            ],
            colWidths=[6.7 * cm, 10.2 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), PAPER),
                    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        ),
        Spacer(1, 0.42 * cm),
        Paragraph("Cierre antes de abrir ventas", styles["StepTitle"]),
        Table(
            [
                [Paragraph("1", styles["SmallHfc"]), Paragraph("Eliminar o inhabilitar todas las claves de Checkout Pro pertenecientes a la empresa anterior.", styles["BodyHfc"])],
                [Paragraph("2", styles["SmallHfc"]), Paragraph("Cargar las nuevas variables en Vercel Production y en .env.local, sin compartir valores por canales inseguros.", styles["BodyHfc"])],
                [Paragraph("3", styles["SmallHfc"]), Paragraph("Desplegar y comprobar que el checkout comunica con la nueva cuenta y que el Webhook llega firmado.", styles["BodyHfc"])],
                [Paragraph("4", styles["SmallHfc"]), Paragraph("Hacer una prueba controlada de pago real solo con autorizacion expresa del propietario. Validar pago, correo, orden, tickets y QR.", styles["BodyHfc"])],
                [Paragraph("5", styles["SmallHfc"]), Paragraph("Mantener ventas deshabilitadas hasta terminar la migracion tributaria. Mercado Pago no cambia por si solo el emisor de DTE o boletas.", styles["BodyHfc"])],
            ],
            colWidths=[0.8 * cm, 16.1 * cm],
            style=TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                    ("BACKGROUND", (0, 0), (0, -1), SOFT_GREEN),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        ),
        Spacer(1, 0.45 * cm),
        callout("Limite importante: Mercado Pago resuelve el cobro. El nuevo RUT emisor de DTE, su proveedor tributario y sus folios se migran por separado antes del lanzamiento.", SOFT_RED, RED),
        Spacer(1, 0.4 * cm),
        Paragraph("Referencias oficiales: Mercado Pago Developers - Checkout API, Credenciales y Webhooks. URL operativa del sitio: https://www.hondafestchile.cl.", styles["SmallHfc"]),
    ]
)


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=MARGIN_X,
    rightMargin=MARGIN_X,
    topMargin=1.45 * cm,
    bottomMargin=1.7 * cm,
    title="Guia de configuracion Mercado Pago - Honda Fest Chile",
    author="Honda Fest Chile",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
