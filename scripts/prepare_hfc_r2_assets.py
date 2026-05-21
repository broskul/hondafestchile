from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from PIL import ExifTags, Image, ImageDraw, ImageFont, ImageOps


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


CATEGORY_LABELS = {
    "autos": "Autos y exhibicion",
    "pista": "Autos en pista",
    "exhibicion": "Exhibicion y paddock",
    "motos": "Motos",
    "moto": "Motos y movilidad",
    "personas": "Personas y comunidad",
    "publico": "Publico y comunidad",
    "premiacion": "Premiacion",
    "escenario": "Escenario y presentaciones",
    "presentacion": "Presentacion y animacion",
    "stands": "Stands y activaciones",
    "marca": "Marca y detalles",
    "servicios": "Servicios y seguridad",
    "acceso": "Acceso y ambiente",
    "charlas": "Charlas y reuniones",
    "japon": "Cultura japonesa",
    "detalle": "Detalles y ambiente",
    "general": "General del evento",
}


EXIF_LABELS = {value: key for key, value in ExifTags.TAGS.items()}


@dataclass(frozen=True)
class Asset:
    source_path: Path
    relative_source: Path
    collection: str
    media_type: str
    original_name: str
    stem: str
    suffix: str
    size_bytes: int
    modified_at: str
    sha256: str
    width: int | None = None
    height: int | None = None
    orientation: str | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    captured_at: str | None = None


def slugify(value: str) -> str:
    value = value.lower()
    value = value.replace("ñ", "n")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or "sin-nombre"


def infer_collection(path: Path) -> str:
    source = path.parts[0] if path.parts else "recursos"
    normalized = slugify(source)
    if "japon" in normalized:
        return "japon-2025"
    if "honda-fest" in normalized:
        return "honda-fest-2025"
    if "img-0769" in normalized:
        return "honda-fest-2025-seleccion"
    return normalized


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_image_metadata(path: Path) -> dict[str, object]:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        metadata: dict[str, object] = {
            "width": width,
            "height": height,
            "orientation": "horizontal" if width >= height else "vertical",
        }
        try:
            exif = image.getexif()
        except Exception:
            exif = {}
        if exif:
            make = exif.get(EXIF_LABELS.get("Make"))
            model = exif.get(EXIF_LABELS.get("Model"))
            captured = exif.get(EXIF_LABELS.get("DateTimeOriginal")) or exif.get(EXIF_LABELS.get("DateTime"))
            if make:
                metadata["camera_make"] = str(make).strip()
            if model:
                metadata["camera_model"] = str(model).strip()
            if captured:
                metadata["captured_at"] = str(captured).strip()
        return metadata


def iter_media_files(source_dir: Path) -> Iterable[Path]:
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.name == ".DS_Store":
            continue
        if path.suffix.lower() in MEDIA_EXTENSIONS:
            yield path


def collect_assets(source_dir: Path) -> list[Asset]:
    assets: list[Asset] = []
    for path in iter_media_files(source_dir):
        relative = path.relative_to(source_dir)
        suffix = path.suffix.lower()
        media_type = "image" if suffix in IMAGE_EXTENSIONS else "video"
        size = path.stat().st_size
        modified_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
        image_metadata: dict[str, object] = {}
        if media_type == "image":
            image_metadata = read_image_metadata(path)
        assets.append(
            Asset(
                source_path=path,
                relative_source=relative,
                collection=infer_collection(relative),
                media_type=media_type,
                original_name=path.name,
                stem=path.stem,
                suffix=suffix,
                size_bytes=size,
                modified_at=modified_at,
                sha256=sha256_file(path),
                width=image_metadata.get("width"),
                height=image_metadata.get("height"),
                orientation=image_metadata.get("orientation"),
                camera_make=image_metadata.get("camera_make"),
                camera_model=image_metadata.get("camera_model"),
                captured_at=image_metadata.get("captured_at"),
            )
        )
    return assets


def choose_font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/calibri.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def make_contact_sheets(assets: list[Asset], output_dir: Path, per_sheet: int = 35) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    tile_w, tile_h = 260, 210
    thumb_h = 166
    cols = 5
    font = choose_font(14)
    small_font = choose_font(12)
    for sheet_index, offset in enumerate(range(0, len(assets), per_sheet), start=1):
        batch = assets[offset : offset + per_sheet]
        rows = math.ceil(len(batch) / cols)
        sheet = Image.new("RGB", (cols * tile_w, rows * tile_h), "white")
        draw = ImageDraw.Draw(sheet)
        for index, asset in enumerate(batch):
            col = index % cols
            row = index // cols
            x = col * tile_w
            y = row * tile_h
            draw.rectangle([x, y, x + tile_w - 1, y + tile_h - 1], outline=(210, 210, 210))
            if asset.media_type == "image":
                with Image.open(asset.source_path) as image:
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((tile_w - 12, thumb_h - 10))
                    px = x + (tile_w - image.width) // 2
                    py = y + 6 + (thumb_h - image.height) // 2
                    sheet.paste(image, (px, py))
            label = f"{offset + index + 1:03d} | {asset.original_name}"
            collection = asset.collection
            draw.text((x + 8, y + thumb_h + 6), label, fill=(20, 20, 20), font=font)
            draw.text((x + 8, y + thumb_h + 26), collection, fill=(90, 90, 90), font=small_font)
        sheet_path = output_dir / f"contact-sheet-{sheet_index:02d}.jpg"
        sheet.save(sheet_path, quality=92)


def write_review_files(assets: list[Asset], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, asset in enumerate(assets, start=1):
        rows.append(
            {
                "index": index,
                "original_name": asset.original_name,
                "relative_source": asset.relative_source.as_posix(),
                "collection": asset.collection,
                "media_type": asset.media_type,
                "size_bytes": asset.size_bytes,
                "width": asset.width or "",
                "height": asset.height or "",
                "orientation": asset.orientation or "",
                "captured_at": asset.captured_at or "",
                "modified_at": asset.modified_at,
                "sha256": asset.sha256,
            }
        )
    with (output_dir / "review-index.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)
    with (output_dir / "review-index.json").open("w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)


def load_classification(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    classifications: dict[str, dict[str, str]] = {}
    for item in data:
        if item.get("relative_source"):
            classifications[str(item["relative_source"])] = item
        if item.get("original_name"):
            classifications[str(item["original_name"])] = item
    return classifications


def describe_asset(
    asset: Asset,
    category: str,
    title: str,
    description: str,
    keywords: str,
    r2_key: str,
) -> str:
    category_label = CATEGORY_LABELS.get(category, category)
    dims = f"{asset.width}x{asset.height}px" if asset.width and asset.height else "sin dimensiones"
    size_mb = asset.size_bytes / 1024 / 1024
    camera = " ".join(part for part in [asset.camera_make, asset.camera_model] if part).strip() or "no disponible"
    captured = asset.captured_at or "no disponible"
    return "\n".join(
        [
            f"Titulo: {title}",
            f"Descripcion: {description}",
            f"Categoria: {category_label}",
            f"Etiquetas: {keywords}",
            f"Evento/Coleccion: {asset.collection}",
            f"Clave R2 sugerida: {r2_key}",
            f"Tipo: {asset.media_type}",
            f"Archivo original: {asset.original_name}",
            f"Ruta original: {asset.relative_source.as_posix()}",
            f"Dimensiones: {dims}",
            f"Orientacion: {asset.orientation or 'no disponible'}",
            f"Tamano: {asset.size_bytes} bytes ({size_mb:.2f} MB)",
            f"Fecha captura EXIF: {captured}",
            f"Fecha modificacion: {asset.modified_at}",
            f"Camara: {camera}",
            f"SHA256: {asset.sha256}",
            "Uso sugerido: galeria web, archivo historico, redes sociales y material de difusion HFC.",
            "",
        ]
    )


def ensure_unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    counter = 2
    while True:
        candidate = path.with_name(f"{path.stem}-{counter}{path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def build_upload_package(source_dir: Path, output_dir: Path, classification_path: Path) -> None:
    classifications = load_classification(classification_path)
    assets = collect_assets(source_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_rows = []
    readme_lines = [
        "# HFC Recursos 2026 - paquete R2",
        "",
        "Estructura pensada para subir a Cloudflare R2 manteniendo coleccion, tipo de medio y categoria visual.",
        "Cada asset tiene un archivo `.txt` vecino con metadata tecnica, descripcion y etiquetas.",
        "",
    ]
    for index, asset in enumerate(assets, start=1):
        item = classifications.get(asset.relative_source.as_posix()) or classifications.get(asset.original_name)
        if not item:
            item = {
                "category": "general",
                "title": f"HFC recurso {asset.stem}",
                "description": "Registro fotografico del evento Honda Fest Chile.",
                "keywords": "hfc, honda fest chile, evento, fotografia",
            }
        category = slugify(item["category"])
        title = item["title"].strip()
        description = item["description"].strip()
        keywords = item["keywords"].strip()
        category_label = CATEGORY_LABELS.get(category, category)
        target_dir = output_dir / asset.collection / asset.media_type / f"{category}-{slugify(category_label)}"
        target_dir.mkdir(parents=True, exist_ok=True)
        safe_stem = f"{index:03d}-{slugify(asset.stem)}"
        target_media = ensure_unique_path(target_dir / f"{safe_stem}{asset.suffix}")
        shutil.copy2(asset.source_path, target_media)
        r2_key = target_media.relative_to(output_dir).as_posix()
        metadata_path = target_media.with_suffix(target_media.suffix + ".txt")
        metadata_path.write_text(
            describe_asset(asset, category, title, description, keywords, r2_key),
            encoding="utf-8",
        )
        manifest_rows.append(
            {
                "index": index,
                "r2_key": r2_key,
                "metadata_key": metadata_path.relative_to(output_dir).as_posix(),
                "category": category_label,
                "collection": asset.collection,
                "media_type": asset.media_type,
                "title": title,
                "description": description,
                "keywords": keywords,
                "original_name": asset.original_name,
                "relative_source": asset.relative_source.as_posix(),
                "size_bytes": asset.size_bytes,
                "width": asset.width or "",
                "height": asset.height or "",
                "orientation": asset.orientation or "",
                "captured_at": asset.captured_at or "",
                "modified_at": asset.modified_at,
                "sha256": asset.sha256,
            }
        )
    if manifest_rows:
        with (output_dir / "_manifest.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(manifest_rows[0].keys()))
            writer.writeheader()
            writer.writerows(manifest_rows)
        with (output_dir / "_manifest.json").open("w", encoding="utf-8") as handle:
            json.dump(manifest_rows, handle, ensure_ascii=False, indent=2)
    readme_lines.extend(
        [
            f"Total assets: {len(manifest_rows)}",
            f"Generado: {datetime.now().isoformat(timespec='seconds')}",
            "",
            "Categorias usadas:",
        ]
    )
    category_counts: dict[str, int] = {}
    for row in manifest_rows:
        category_counts[row["category"]] = category_counts.get(row["category"], 0) + 1
    for category, count in sorted(category_counts.items()):
        readme_lines.append(f"- {category}: {count}")
    (output_dir / "_README.txt").write_text("\n".join(readme_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare HFC assets for Cloudflare R2.")
    parser.add_argument("--source", default="HFC Recursos 2026")
    parser.add_argument("--review-dir", default="_hfc_asset_review")
    parser.add_argument("--output", default="HFC_R2_upload_ready")
    parser.add_argument("--classification", default="_hfc_asset_review/classification.json")
    parser.add_argument("--mode", choices=["review", "package"], default="review")
    args = parser.parse_args()

    source_dir = Path(args.source).resolve()
    if args.mode == "review":
        assets = collect_assets(source_dir)
        review_dir = Path(args.review_dir).resolve()
        write_review_files(assets, review_dir)
        make_contact_sheets(assets, review_dir / "contact_sheets")
        print(f"Review generated: {review_dir}")
        print(f"Assets: {len(assets)}")
        return

    build_upload_package(source_dir, Path(args.output).resolve(), Path(args.classification).resolve())
    print(f"Package generated: {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
