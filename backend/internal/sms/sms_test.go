package sms

import (
	"testing"
)

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		input    string
		expected string
		wantErr  bool
	}{
		{"+7 (920) 998-16-39", "79209981639", false},
		{"89209981639", "79209981639", false},
		{"79209981639", "79209981639", false},
		{"9209981639", "79209981639", false},
		{"+79209981639", "79209981639", false},
		{"12345", "", true},
		{"+12345678901", "", true},
	}

	for _, tc := range cases {
		out, err := NormalizePhone(tc.input)
		if tc.wantErr && err == nil {
			t.Errorf("NormalizePhone(%q) expected error, got nil", tc.input)
		}
		if !tc.wantErr && err != nil {
			t.Errorf("NormalizePhone(%q) unexpected error: %v", tc.input, err)
		}
		if out != tc.expected {
			t.Errorf("NormalizePhone(%q) = %q; want %q", tc.input, out, tc.expected)
		}
	}
}
