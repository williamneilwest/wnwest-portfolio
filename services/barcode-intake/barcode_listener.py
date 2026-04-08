import os
import requests
import json
import evdev
import time

############################
# CONFIG FROM ENV
############################

GROCY_URL = os.getenv("GROCY_URL")
GROCY_API_KEY = os.getenv("GROCY_API_KEY")

SCANNER_DEVICE = "/dev/input/event13"

HEADERS = {
    "GROCY-API-KEY": GROCY_API_KEY,
    "Content-Type": "application/json"
}

DEFAULT_LOCATION_ID = 1
DEFAULT_QU_ID = 1

############################
# GROCY API HELPERS
############################

def get_product_by_barcode(barcode):

    r = requests.get(
        f"{GROCY_URL}/stock/products/by-barcode/{barcode}",
        headers=HEADERS
    )

    if r.status_code == 200:
        return r.json()

    return None


def create_product(name):

    payload = {
        "name": name,
        "location_id": DEFAULT_LOCATION_ID,
        "qu_id_purchase": DEFAULT_QU_ID,
        "qu_id_stock": DEFAULT_QU_ID
    }

    r = requests.post(
        f"{GROCY_URL}/objects/products",
        headers=HEADERS,
        data=json.dumps(payload)
    )

    if r.status_code not in [200,201]:
        print("Product creation failed:", r.text)
        return None

    return r.json()["created_object_id"]


def attach_barcode(product_id, barcode):

    payload = {
        "product_id": product_id,
        "barcode": barcode
    }

    requests.post(
        f"{GROCY_URL}/objects/product_barcodes",
        headers=HEADERS,
        data=json.dumps(payload)
    )


def add_stock(product_id):

    payload = {
        "amount": 1,
        "price": 0
    }

    r = requests.post(
        f"{GROCY_URL}/stock/products/{product_id}/add",
        headers=HEADERS,
        json=payload
    )

    if r.status_code not in [200,204]:
        print("Stock add failed:", r.text)


############################
# OPEN FOOD FACTS
############################

def lookup_openfoodfacts(barcode):

    try:
        r = requests.get(
            f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json",
            timeout=10
        )

        data = r.json()

        if data["status"] != 1:
            return None

        product = data["product"]

        return {
            "name": product.get("product_name", f"Unknown {barcode}"),
            "image": product.get("image_front_url", "")
        }

    except:
        return None


def upload_image(product_id, image_url):

    if not image_url:
        return

    try:
        img = requests.get(image_url).content

        files = {
            "file": ("image.jpg", img)
        }

        requests.post(
            f"{GROCY_URL}/files/productpictures/{product_id}",
            headers={"GROCY-API-KEY": GROCY_API_KEY},
            files=files
        )

    except:
        print("Image upload failed")


############################
# PRODUCT CREATION PIPELINE
############################

def create_from_barcode(barcode):

    print("Unknown barcode. Searching OpenFoodFacts")

    food = lookup_openfoodfacts(barcode)

    if food:
        name = food["name"]
        image = food["image"]
    else:
        name = f"Unknown {barcode}"
        image = None

    product_id = create_product(name)

    if not product_id:
        return

    attach_barcode(product_id, barcode)

    upload_image(product_id, image)

    add_stock(product_id)

    print("Created product:", name)


############################
# BARCODE HANDLER
############################

def process_barcode(barcode):

    print("Scanned:", barcode)

    product = get_product_by_barcode(barcode)

    if product:

        product_id = product["product"]["id"]

        print("Product exists:", product["product"]["name"])

        add_stock(product_id)

    else:

        create_from_barcode(barcode)


############################
# SCANNER LOOP
############################

def scanner_loop():

    device = evdev.InputDevice(SCANNER_DEVICE)

    print("Using scanner:", device)

    barcode = ""

    for event in device.read_loop():

        if event.type == evdev.ecodes.EV_KEY:

            key = evdev.categorize(event)

            if key.keystate == 1:

                if key.keycode == "KEY_ENTER":

                    process_barcode(barcode)
                    barcode = ""

                else:

                    char = key.keycode.replace("KEY_", "")

                    if char.isdigit():
                        barcode += char


############################
# START
############################

if __name__ == "__main__":

    print("Starting barcode intake service...", flush=True)

    while True:
        try:
            scanner_loop()
        except Exception as e:
            print("Scanner error:", e, flush=True)
            time.sleep(5)
