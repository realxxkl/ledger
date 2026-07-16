import { NextRequest, NextResponse } from 'next/server'

// Fetch the current EGP/USD exchange rate from a free API
export async function GET(request: NextRequest) {
  try {
    // Using jsdelivr's free currency API (no auth required)
    // Returns the exchange rate for USD in all currencies
    const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch exchange rate' },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!data.usd || !data.usd.egp) {
      return NextResponse.json(
        { error: 'EGP rate not found in response' },
        { status: 400 }
      )
    }

    // Return the rate: how many EGP per 1 USD
    // So 1 USD = data.usd.egp EGP
    // To convert EGP to USD: egpAmount / rate = usdAmount
    const egpPerUsd = data.usd.egp

    return NextResponse.json({
      rate: egpPerUsd,
      usdToEgp: egpPerUsd,
      egpToUsd: 1 / egpPerUsd,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Exchange rate API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch exchange rate' },
      { status: 500 }
    )
  }
}
