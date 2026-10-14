import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ReviewPage } from './review/ReviewPage'
import { isReviewView } from './review/review'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isReviewView(window.location.search) ? <ReviewPage /> : <App />}</StrictMode>,
)
