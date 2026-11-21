"""Arma de verdad los grupos de botones de opción de un PDF hecho con hyperref.

hyperref (pdfTeX) dibuja cada botón de un \\ChoiceMenu[radio] como un campo
suelto con el mismo nombre, y solo anota el primero en el formulario. Hay
visores que los juntan por el nombre y otros que no: en esos, marcar FALLA no
desmarca OK, o la respuesta no queda guardada. Este script convierte cada
grupo en lo que pide la norma PDF: un campo padre con el nombre, el tipo y el
valor, y los botones como hijos que solo dibujan.

Uso:  python3 -I formulario-radios.py entrada.pdf salida.pdf
(entrada y salida pueden ser el mismo archivo)
"""
import sys
from collections import OrderedDict

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, DictionaryObject, NameObject,
                           NumberObject, TextStringObject, BooleanObject)

RADIO = 1 << 15          # Ff: botón de opción
NO_APAGAR = 1 << 14      # Ff: no se puede dejar el grupo vacío tocando el marcado


def es_radio(widget):
    return (widget.get('/FT') == '/Btn'
            and int(widget.get('/Ff', 0)) & RADIO
            and '/T' in widget and '/Parent' not in widget)


def main(entrada, salida):
    escritor = PdfWriter(clone_from=PdfReader(entrada))
    raiz = escritor._root_object
    formulario = raiz['/AcroForm']

    grupos = OrderedDict()
    for pagina in escritor.pages:
        for ref in pagina.get('/Annots', []):
            w = ref.get_object()
            if w.get('/Subtype') == '/Widget' and es_radio(w):
                grupos.setdefault(str(w['/T']), []).append((ref, w))

    campos = ArrayObject()
    ya = set()
    for ref in formulario['/Fields']:
        w = ref.get_object()
        nombre = str(w.get('/T', ''))
        if nombre in grupos:
            if nombre in ya:
                continue
            ya.add(nombre)
            padre = DictionaryObject({
                NameObject('/FT'): NameObject('/Btn'),
                # Sin NO_APAGAR: tocar el marcado lo desmarca, por si se
                # equivocó de fila
                NameObject('/Ff'): NumberObject(RADIO),
                NameObject('/T'): TextStringObject(nombre),
                NameObject('/V'): NameObject('/Off'),
                NameObject('/DV'): NameObject('/Off'),
            })
            ref_padre = escritor._add_object(padre)
            hijos = ArrayObject()
            for ref_w, w in grupos[nombre]:
                for clave in ('/T', '/FT', '/Ff', '/V', '/DV'):
                    if clave in w:
                        del w[clave]
                w[NameObject('/Parent')] = ref_padre
                w[NameObject('/AS')] = NameObject('/Off')
                hijos.append(ref_w)
            padre[NameObject('/Kids')] = hijos
            campos.append(ref_padre)
        else:
            campos.append(ref)
    formulario[NameObject('/Fields')] = campos
    formulario[NameObject('/NeedAppearances')] = BooleanObject(True)
    with open(salida, 'wb') as f:
        escritor.write(f)
    print(f'{len(grupos)} grupos de opción armados, {len(campos)} campos en el formulario')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
